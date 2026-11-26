// The monthly goal, worked backwards into what to do each week.
//
// The method is the usual sales one — money wanted ÷ price = jobs, jobs ÷ close
// rate = leads, leads ÷ reply rate = messages — reshaped by an audit of every
// booking and client on 2026-10-10:
//
// - There is no sales call. The steps are text → reply → interested → client.
// - Clients repeat. Half of October's jobs (4 of 8, $950) were second or later
//   jobs, so the month is split into what repeat clients bring and what new
//   clients have to, and only the second part is turned into texts.
// - Every rate is measured from his own outreach. The last one, interested →
//   client, is judged only on people first contacted three weeks ago or more,
//   because that's how long a booking takes to follow (email clients booked 1
//   to 14 days after the first message, the two won by text 23 and 24). It
//   came out at 6 of 32, far above the 1 in 50 he had guessed, and what's used
//   is the cautious end of what a sample that small supports (see lowerBound).
//   It tightens toward the real figure on its own as more people age in.
// - The targets are a steady weekly pace, not this month's gap squeezed into
//   the weeks left: a text sent in the last week of a month can't book a job in
//   it.
//
// The goal is the HOME goal: Local and Regional work only (2026-11-13).
// Shooter-market jobs (the markets table's kind "shooter": Portland first, then
// the Central Coast) are subcontracted and pay him less, so their outreach sits
// on top of home outreach, never instead of it. Each live shooter market gets a
// quota of its own, worked back from its `jobsPerWeek` (Portland: a couple of
// bookings a week by the new year). Paused and killed markets, and
// "unassigned" (out of state), are neither home nor quota: nothing of theirs
// counts toward home.
//
// All quotas split outreach by market the way the Home funnel does
// (lib/funnelSplit.ts): the listing on the send, else the agent's own market
// (lib/agentMarket.ts), else regional. Bookings are placed by their listing, or
// by their own address when they have none; anything outside Local and
// Regional — shooter markets and "unassigned" — is left out of every home
// figure (booked work, jobs, repeat and first-job values, new clients), so it
// can never make the home goal look closer than it is.
//
// Cold follow-up texts (agents who never answered the first text, recorded only
// as outbound interactions on a `cold_*` Follow up feed) are in neither quota:
// no count, no reply rate, nothing on the goal card. Their value per text is
// unknown, so they're measured apart (feeds/stats.ts allCold). Both queries
// below that look at agent_interactions skip them.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getFollowUpBoard } from "@/app/follow-up/data";
import { agentMarkets } from "@/lib/agentMarket";
import { getMarkets } from "@/lib/marketsData";
import type { Market, MarketPlace } from "@/lib/markets";

/** Dollars of booked work a month. Change it here. Raised from $3,000 on 2026-10-15, after October passed it mid-month. */
export const MONTHLY_GOAL = 4000;

/** Lukas's own estimate (2026-10-10): 1 in 50 interested agents. Only used when there are too few people to measure. */
const ASSUMED_BOOK_RATE = 0.02;
/** How long after first contact someone has had a fair chance to book. */
const MATURE_DAYS = 21;
/** Interested agents past that age before the measured rate replaces the assumed one. */
const MIN_SAMPLE = 15;
/** One-sided 90%: the rate is this high or higher nine times in ten. */
const CAUTION_Z = 1.2816;
const WEEKS_PER_MONTH = 52 / 12;
/** Fallbacks for a rate with too little behind it to trust. */
const DEFAULT_REPLY_RATE = 0.25;
const DEFAULT_INTERESTED_RATE = 0.2;
/** Sends in the last 28 days needed before a market's own reply rate replaces the overall one. */
const MIN_REPLY_SAMPLE = 50;
/** An interested agent counts toward the goal only if there has been contact, either way, this recently. */
const LIVE_DAYS = 30;

/**
 * The low end of what `hits` out of `n` supports (a Wilson bound). Planning on
 * 6 of 32 as if it were exactly 19% would be counting on luck; this gives 11%
 * for that, and closes in on the plain ratio as n grows.
 */
function lowerBound(hits: number, n: number): number {
  if (n === 0) return 0;
  const p = hits / n;
  const z2 = CAUTION_Z * CAUTION_Z;
  const centre = p + z2 / (2 * n);
  const spread = CAUTION_Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - spread) / (1 + z2 / n));
}

/** The plain average, 0 for nothing to average. */
function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Today's share of a week: what's left of it as of this morning, spread over the days left (Mon–Sat). */
function todayTarget(textsPerWeek: number, weekTexts: number, todayTexts: number, dow: number): number {
  return Math.ceil(Math.max(0, textsPerWeek - (weekTexts - todayTexts)) / (dow <= 6 ? 7 - dow : 1));
}

const TZ = "America/Los_Angeles";

/**
 * The markets whose work the home goal covers: everything else — shooter
 * markets, paused or killed ones and "unassigned" — is outreach on top of it.
 */
const HOME_MARKETS = new Set<Market>(["local", "regional"]);

/**
 * One market's texting quota. The home one's numbers are the same as the
 * top-level thisWeek / today / plan; each shooter market's is on top of them.
 */
export interface MarketQuota {
  /** The shooter market's key ("portland", "central_coast"); absent on the home quota. */
  key?: string;
  /** "Local + Regional" | "Portland" | "Central Coast". */
  label: string;
  textsPerWeek: number;
  repliesPerWeek: number;
  replyRate: number;
  /** False while the market's reply rate is the overall one, for want of sends to measure. */
  replyRateMeasured: boolean;
  week: { texts: number; textsToGo: number; replies: number };
  today: { texts: number; textsTarget: number };
  /** One sentence on what the quota is worked back from. */
  note: string;
}

export interface GoalProgress {
  goal: number;
  /** "October". */
  month: string;
  /** Value of the jobs dated this month, done or still to come, shooter markets left out. */
  booked: number;
  jobs: number;
  /** What's left to book this month. 0 once the goal is met. */
  gap: number;
  avgJob: number;
  jobsNeeded: number;
  rates: {
    reply: number;
    interested: number;
    /** Interested agents who become clients: the cautious end of `bookSample`. */
    book: number;
    /** False while `book` is the assumed 1 in 50, for want of people to measure. */
    bookMeasured: boolean;
  };
  /** What `rates.book` rests on: interested agents first contacted three weeks ago or more, and how many booked. */
  bookSample: { booked: number; of: number };
  /** Interested agents in touch in the last 30 days, and how many a month the plan takes. */
  interested: { live: number; needed: number };
  /** The steady pace that reaches the goal. Home only: shooter markets are `quotas.markets`. */
  plan: {
    /** This month's work from people who had already booked before. */
    repeat: number;
    /** What new clients have to bring in a month: the goal less repeat work. */
    newRevenue: number;
    /** What a client's first job has been worth, free ones included. */
    firstJob: number;
    newClientsPerMonth: number;
    /** Agents whose first booking was made this month. */
    newClientsThisMonth: number;
    textsPerWeek: number;
    repliesPerWeek: number;
  };
  /** The same estimate in a sentence, for both the web and the phone to show. */
  note: string;
  /** Still to do this week to stay on pace: already net of what this week has done. Home only. */
  thisWeek: {
    textsToGo: number;
    repliesToGo: number;
    /** Sent and received so far this week (Monday on, Pacific), home markets only. */
    texts: number;
    replies: number;
    followUps: number;
    /** Everyone waiting on the Follow up page: the same list, so the two can't disagree. */
    followUpsDue: number;
  };
  /** Today's share of the week: what's left of it as of this morning, spread over the days left (Mon–Sat). Home only. */
  today: {
    texts: number;
    textsTarget: number;
  };
  /**
   * The same week and today once for home, then once per live shooter market
   * (in market sort order), each on top of home. `portland` repeats the
   * Portland entry of `markets` for older iPhone builds that only read it.
   */
  quotas: { home: MarketQuota; portland: MarketQuota; markets: MarketQuota[] };
}

/** One initial-outreach text, placed in a market, with the facts both quotas need. */
interface SendRow {
  agent_id: string | null;
  listing_id: string | null;
  listing_city: string | null;
  listing_state: string | null;
  listing_lat: number | null;
  listing_lng: number | null;
  listing_geocode_source: string | null;
  replied: boolean;
  replied_this_week: boolean;
  in_28: boolean;
  in_week: boolean;
  in_today: boolean;
}

/** One booking, with the geo fields of its listing (when it has one) and of its own address. */
interface JobRow {
  contact_agent_id: string | null;
  value: number;
  nth: number;
  listing_id: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  geocode_source: string | null;
  listing_city: string | null;
  listing_state: string | null;
  listing_lat: number | null;
  listing_lng: number | null;
  listing_geocode_source: string | null;
  in_month: boolean;
  in_prev_month: boolean;
  first_this_month: boolean;
}

export async function computeGoalProgress(): Promise<GoalProgress> {
  const [mk, board, totals, jobResult, sendResult] = await Promise.all([
    getMarkets(),
    getFollowUpBoard(),
    // The rates that don't split by market, and the bounds (Pacific) that the
    // send and job queries below repeat, so all three run in one round trip.
    db.execute(sql`
      with bounds as (
        select
          date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ} as month_start,
          (date_trunc('month', now() at time zone ${TZ}) + interval '1 month') at time zone ${TZ} as month_end,
          date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ} as week_start,
          date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ} as day_start,
          extract(isodow from now() at time zone ${TZ})::int as dow
      ),
      -- The first time he reached out to each agent, by any channel.
      reached as (
        select agent_id, min(at) as at from (
          select s.agent_id, s.sent_at as at
          from message_sends s join message_presets p on p.id = s.preset_id
          where p.type = 'initial_outreach' and s.agent_id is not null
          union all
          select i.agent_id, i.occurred_at from agent_interactions i
          where i.direction = 'outbound' and i.agent_id is not null
        ) x group by agent_id
      ),
      -- Everyone who got as far as interested and has had time to book since.
      mature as (
        select r.agent_id,
          exists (select 1 from bookings b where b.contact_agent_id = r.agent_id and b.created_at > r.at) as booked
        from reached r join agents a on a.id = r.agent_id
        where r.at < now() - make_interval(days => ${MATURE_DAYS})
          and (a.relationship_status in ('interested', 'worked_once', 'regular')
            or exists (select 1 from bookings b where b.contact_agent_id = r.agent_id and b.created_at > r.at))
      ),
      -- First outreach text per agent, and whether any of them was answered.
      texted as (
        select s.agent_id, min(s.sent_at) as first_text, bool_or(s.responded_at is not null) as replied
        from message_sends s join message_presets p on p.id = s.preset_id
        where s.channel = 'sms' and p.type = 'initial_outreach' and s.agent_id is not null
        group by s.agent_id
      ),
      last_inbound as (
        select agent_id, max(occurred_at) as at from agent_interactions where direction = 'inbound' group by agent_id
      )
      select
        to_char(now() at time zone ${TZ}, 'FMMonth') as month,
        (select count(*) from mature)::int as mature_interested,
        (select count(*) from mature where booked)::int as mature_booked,
        (select count(*) from texted where replied)::int as repliers,
        (select count(*) from texted t join agents a on a.id = t.agent_id
          where t.replied and a.relationship_status in ('interested', 'worked_once', 'regular'))::int as repliers_interested,
        (select count(*) from agents a left join last_inbound i on i.agent_id = a.id
          where a.relationship_status = 'interested'
            and greatest(a.last_contacted_at, i.at) > now() - make_interval(days => ${LIVE_DAYS}))::int as interested_live,
        (select dow from bounds) as dow,
        -- A text to someone he had already texted before this week began. Cold
        -- follow-up texts are left out: they're a later nudge to a cold agent,
        -- counted apart (feeds/stats.ts allCold), not follow-up work on a live
        -- conversation.
        (select count(*) from agent_interactions x, bounds
          where x.channel = 'text' and x.direction = 'outbound' and x.occurred_at >= week_start
            and left(coalesce(x.follow_up_feed, ''), 5) <> 'cold_'
            and exists (
              select 1 from agent_interactions y
              where y.agent_id = x.agent_id and y.direction = 'outbound' and y.occurred_at < week_start
            ))::int as week_follow_ups
    `),
    // Every booking with what's needed to place it in a market and to tell a
    // first job from a repeat one. Small enough (one photographer's book) to
    // bring back whole and filter in JS, which keeps the Portland cut in one
    // place instead of repeated across a dozen aggregates.
    db.execute(sql`
      with bounds as (
        select
          date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ} as month_start,
          (date_trunc('month', now() at time zone ${TZ}) + interval '1 month') at time zone ${TZ} as month_end
      ),
      job as (
        select b.id, b.contact_agent_id, b.created_at, coalesce(b.job_date, b.created_at) as at,
          (select coalesce(sum(amount), 0) from booking_line_items li where li.booking_id = b.id)::int as value,
          -- Which job of this client's it is. A job with no agent on it is taken as a first.
          case when b.contact_agent_id is null then 1
            else row_number() over (partition by b.contact_agent_id order by coalesce(b.job_date, b.created_at)) end::int as nth,
          b.listing_id, b.city, b.state, b.lat, b.lng, b.geocode_source,
          l.city as listing_city, l.state as listing_state, l.lat as listing_lat,
          l.lng as listing_lng, l.geocode_source as listing_geocode_source
        from bookings b left join listings l on l.id = b.listing_id
      ),
      first_job as (
        select contact_agent_id, min(created_at) as first
        from job where contact_agent_id is not null group by 1
      )
      select
        j.contact_agent_id, j.value, j.nth, j.listing_id,
        j.city, j.state, j.lat, j.lng, j.geocode_source,
        j.listing_city, j.listing_state, j.listing_lat, j.listing_lng, j.listing_geocode_source,
        (j.at >= bd.month_start and j.at < bd.month_end) as in_month,
        (j.at >= bd.month_start - interval '1 month' and j.at < bd.month_start) as in_prev_month,
        exists (select 1 from first_job f
          where f.contact_agent_id = j.contact_agent_id and f.first >= bd.month_start) as first_this_month
      from job j, bounds bd
    `),
    // Every initial-outreach text in the window the quotas look at: the last 28
    // days for the reply rate, plus this week and today for the counts (both
    // inside 28 days unless a week ever runs longer than one).
    db.execute(sql`
      with bounds as (
        select
          date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ} as week_start,
          date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ} as day_start
      )
      select
        s.agent_id, s.listing_id,
        l.city as listing_city, l.state as listing_state, l.lat as listing_lat,
        l.lng as listing_lng, l.geocode_source as listing_geocode_source,
        (s.responded_at is not null) as replied,
        (s.responded_at >= bd.week_start) as replied_this_week,
        (s.sent_at > now() - interval '28 days') as in_28,
        (s.sent_at >= bd.week_start) as in_week,
        (s.sent_at >= bd.day_start) as in_today
      from message_sends s
      join message_presets p on p.id = s.preset_id
      left join listings l on l.id = s.listing_id
      cross join bounds bd
      where s.channel = 'sms' and p.type = 'initial_outreach'
        and s.sent_at >= least(now() - interval '28 days', bd.week_start)
    `),
  ]);
  const r = totals.rows[0] as Record<string, number | string | null>;
  const n = (key: string) => Number(r[key] ?? 0);
  const dow = n("dow");

  // --- Texting quotas, by market -------------------------------------------

  const sends = sendResult.rows as unknown as SendRow[];
  // Texts sent with no listing on them (cold-email imports, manual sends) fall
  // back to the agent's own market, one query for just those ids.
  const fallback = await agentMarkets(
    sends.filter((s) => s.listing_id == null && s.agent_id != null).map((s) => s.agent_id as string),
  );

  const placed = sends.map((send) => {
    const market: Market =
      send.listing_id != null
        ? mk.marketFor({
            city: send.listing_city,
            state: send.listing_state,
            lat: send.listing_lat,
            lng: send.listing_lng,
            geocodeSource: send.listing_geocode_source,
          })
        : fallback.get(send.agent_id ?? "") ?? "regional";
    return { send, market };
  });
  // Home is Local + Regional only: a shooter market (live or not) and
  // "unassigned" never count toward the home pace.
  const homeSends = placed.filter((p) => HOME_MARKETS.has(p.market)).map((p) => p.send);

  const tally = (rows: SendRow[]) => ({
    sent28: rows.filter((s) => s.in_28).length,
    replied28: rows.filter((s) => s.in_28 && s.replied).length,
    weekTexts: rows.filter((s) => s.in_week).length,
    weekReplies: rows.filter((s) => s.replied_this_week).length,
    todayTexts: rows.filter((s) => s.in_today).length,
  });
  const allTexts = tally(sends);
  const homeTexts = tally(homeSends);

  // --- Bookings, home only (Local + Regional) -------------------------------

  const jobs = (jobResult.rows as unknown as JobRow[]).filter((row) => {
    const place: MarketPlace =
      row.listing_id != null
        ? {
            city: row.listing_city,
            state: row.listing_state,
            lat: row.listing_lat,
            lng: row.listing_lng,
            geocodeSource: row.listing_geocode_source,
          }
        : { city: row.city, state: row.state, lat: row.lat, lng: row.lng, geocodeSource: row.geocode_source };
    return HOME_MARKETS.has(mk.marketFor(place));
  });

  const monthJobs = jobs.filter((j) => j.in_month);
  const booked = monthJobs.reduce((sum, j) => sum + j.value, 0);
  const jobCount = monthJobs.length;
  const avgJob = Math.round(mean(jobs.filter((j) => j.value > 0).map((j) => j.value))) || 250;
  const firstJob = Math.round(mean(jobs.filter((j) => j.nth === 1).map((j) => j.value))) || avgJob;
  const repeatNow = jobs.filter((j) => j.nth > 1 && j.in_month).reduce((sum, j) => sum + j.value, 0);
  const repeatBefore = jobs.filter((j) => j.nth > 1 && j.in_prev_month).reduce((sum, j) => sum + j.value, 0);
  const newClients = new Set(jobs.filter((j) => j.first_this_month).map((j) => j.contact_agent_id)).size;

  const gap = Math.max(0, MONTHLY_GOAL - booked);
  const jobsNeeded = Math.ceil(gap / avgJob);

  // --- The rates ------------------------------------------------------------

  // A market's own reply rate once it has the sends behind it, else the
  // overall rate, else the guess.
  const overallReply =
    allTexts.sent28 >= MIN_REPLY_SAMPLE ? allTexts.replied28 / allTexts.sent28 : DEFAULT_REPLY_RATE;
  const replyMeasured = homeTexts.sent28 >= MIN_REPLY_SAMPLE;
  const reply = replyMeasured ? homeTexts.replied28 / homeTexts.sent28 : overallReply;
  const interestedRate = n("repliers") >= 20 ? n("repliers_interested") / n("repliers") : DEFAULT_INTERESTED_RATE;
  const bookSample = { booked: n("mature_booked"), of: n("mature_interested") };
  const bookMeasured = bookSample.of >= MIN_SAMPLE && bookSample.booked > 0;
  const book = bookMeasured ? lowerBound(bookSample.booked, bookSample.of) : ASSUMED_BOOK_RATE;

  // --- The home plan --------------------------------------------------------

  // Repeat clients first. This month's figure is thin early in a month, before
  // its jobs are booked, so last month's stands in until it's passed.
  const repeat = repeatNow;
  const newRevenue = Math.max(0, MONTHLY_GOAL - Math.max(repeat, repeatBefore));

  // Then back up the funnel for the rest: new clients → interested agents →
  // replies → texts, a month's worth, spread evenly over its weeks.
  const newClientsPerMonth = newRevenue / firstJob;
  const interestedPerMonth = newClientsPerMonth / book;
  const repliesPerWeek = Math.ceil(interestedPerMonth / Math.max(interestedRate, 0.01) / WEEKS_PER_MONTH);
  const textsPerWeek = Math.ceil(repliesPerWeek / Math.max(reply, 0.01));
  const live = n("interested_live");

  // --- The words ------------------------------------------------------------

  const percent = (rate: number) => `${Math.round(rate * 100)}%`;
  const dollars = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;
  const clients = Math.ceil(newClientsPerMonth);
  const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

  // --- The shooter-market plans, each on top of home ------------------------

  // A shooter market has too few bookings to measure its own interested →
  // client rate, so it plans on the same `book` as home and works back from
  // its weekly job target (`jobsPerWeek`) instead.
  const shooterQuota = (key: string, label: string, jobsPerWeek: number): MarketQuota => {
    const texts = tally(placed.filter((p) => p.market === key).map((p) => p.send));
    const measured = texts.sent28 >= MIN_REPLY_SAMPLE;
    const replyRate = measured ? texts.replied28 / texts.sent28 : overallReply;
    const interestedPerWeek = jobsPerWeek / book;
    const repliesPerWeek = Math.ceil(interestedPerWeek / Math.max(interestedRate, 0.01));
    const textsPerWeek = Math.ceil(repliesPerWeek / Math.max(replyRate, 0.01));
    const note =
      `${plural(jobsPerWeek, `${label} job`)} a week, on top of home: about ` +
      `${plural(Math.ceil(interestedPerWeek), "interested agent")} and ${plural(repliesPerWeek, "reply", "replies")} a week ` +
      `at a ${percent(replyRate)} reply rate (` +
      (measured ? `${label}'s own` : `the overall rate, for want of ${MIN_REPLY_SAMPLE} ${label} sends to measure`) +
      `), so ${plural(textsPerWeek, "text")}.`;
    return {
      key,
      label,
      textsPerWeek,
      repliesPerWeek,
      replyRate,
      replyRateMeasured: measured,
      week: {
        texts: texts.weekTexts,
        textsToGo: Math.max(0, textsPerWeek - texts.weekTexts),
        replies: texts.weekReplies,
      },
      today: {
        texts: texts.todayTexts,
        textsTarget: todayTarget(textsPerWeek, texts.weekTexts, texts.todayTexts, dow),
      },
      note,
    };
  };
  const marketQuotas = mk.liveShooterMarkets.map((m) => shooterQuota(m.key, m.label, m.jobsPerWeek));
  const note =
    `Local + Regional: repeat clients cover ${dollars(MONTHLY_GOAL - newRevenue)} of a month, so new ones need to bring ` +
    `${dollars(newRevenue)}, about ${plural(clients, "client")} at ${dollars(firstJob)} a first job. ` +
    `${percent(reply)} of texts get a reply, ${percent(interestedRate)} of those turn interested, and ` +
    (bookMeasured
      ? `about 1 in ${Math.round(1 / book)} interested agents books: the cautious end of ${bookSample.booked} of ` +
        `${bookSample.of} so far, counting only people first contacted ${MATURE_DAYS / 7} weeks ago or more.`
      : `1 in ${Math.round(1 / book)} interested agents books (a guess until more of them have had time to).`);

  const homeQuotaNote =
    `${dollars(newRevenue)} of new work a month, about ${plural(clients, "new client")} at ${dollars(firstJob)} a first job: ` +
    `${plural(repliesPerWeek, "reply", "replies")} and ${plural(textsPerWeek, "text")} a week.`;

  // --- Assemble -------------------------------------------------------------

  const homeWeek = { texts: homeTexts.weekTexts, replies: homeTexts.weekReplies };
  const textsToGo = Math.max(0, textsPerWeek - homeWeek.texts);
  const repliesToGo = Math.max(0, repliesPerWeek - homeWeek.replies);

  return {
    goal: MONTHLY_GOAL,
    month: String(r.month),
    booked,
    jobs: jobCount,
    gap,
    avgJob,
    jobsNeeded,
    rates: { reply, interested: interestedRate, book, bookMeasured },
    bookSample,
    interested: { live, needed: Math.ceil(interestedPerMonth) },
    plan: {
      repeat,
      newRevenue,
      firstJob,
      newClientsPerMonth: Math.round(newClientsPerMonth * 10) / 10,
      newClientsThisMonth: newClients,
      textsPerWeek,
      repliesPerWeek,
    },
    note,
    thisWeek: {
      textsToGo,
      repliesToGo,
      texts: homeWeek.texts,
      replies: homeWeek.replies,
      followUps: n("week_follow_ups"),
      followUpsDue: board.today.length + board.later.length,
    },
    today: {
      texts: homeTexts.todayTexts,
      textsTarget: todayTarget(textsPerWeek, homeWeek.texts, homeTexts.todayTexts, dow),
    },
    quotas: {
      home: {
        label: "Local + Regional",
        textsPerWeek,
        repliesPerWeek,
        replyRate: reply,
        replyRateMeasured: replyMeasured,
        week: {
          texts: homeWeek.texts,
          textsToGo,
          replies: homeWeek.replies,
        },
        today: {
          texts: homeTexts.todayTexts,
          textsTarget: todayTarget(textsPerWeek, homeWeek.texts, homeTexts.todayTexts, dow),
        },
        note: homeQuotaNote,
      },
      // Older iPhone builds read only this; newer clients use `markets`. With
      // no live shooter markets it's a zero quota rather than nothing, so the
      // old client shows "0 of 0" instead of crashing.
      portland: marketQuotas.find((q) => q.key === "portland") ??
        marketQuotas[0] ?? {
          key: "portland",
          label: "Portland",
          textsPerWeek: 0,
          repliesPerWeek: 0,
          replyRate: 0,
          replyRateMeasured: false,
          week: { texts: 0, textsToGo: 0, replies: 0 },
          today: { texts: 0, textsTarget: 0 },
          note: "No shooter markets are live.",
        },
      markets: marketQuotas,
    },
  };
}
