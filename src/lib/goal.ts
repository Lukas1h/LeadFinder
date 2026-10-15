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

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getFollowUpBoard } from "@/app/follow-up/data";

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

const TZ = "America/Los_Angeles";

export interface GoalProgress {
  goal: number;
  /** "October". */
  month: string;
  /** Value of the jobs dated this month, done or still to come. */
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
  /** The steady pace that reaches the goal. */
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
  /** Still to do this week to stay on pace: already net of what this week has done. */
  thisWeek: {
    textsToGo: number;
    repliesToGo: number;
    /** Sent and received so far this week (Monday on, Pacific). */
    texts: number;
    replies: number;
    followUps: number;
    /** Everyone waiting on the Follow up page: the same list, so the two can't disagree. */
    followUpsDue: number;
  };
  /** Today's share of the week: what's left of it as of this morning, spread over the days left (Mon–Sat). */
  today: {
    texts: number;
    textsTarget: number;
  };
}

export async function computeGoalProgress(): Promise<GoalProgress> {
  const [board, result] = await Promise.all([getFollowUpBoard(), db.execute(sql`
    with bounds as (
      select
        date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ} as month_start,
        (date_trunc('month', now() at time zone ${TZ}) + interval '1 month') at time zone ${TZ} as month_end,
        date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ} as week_start,
        date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ} as day_start,
        extract(isodow from now() at time zone ${TZ})::int as dow
    ),
    job as (
      select b.id, b.contact_agent_id, b.created_at, coalesce(b.job_date, b.created_at) as at,
        (select coalesce(sum(amount), 0) from booking_line_items li where li.booking_id = b.id) as value,
        -- Which job of this client's it is. A job with no agent on it is taken as a first.
        case when b.contact_agent_id is null then 1
          else row_number() over (partition by b.contact_agent_id order by coalesce(b.job_date, b.created_at)) end as nth
      from bookings b
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
    outreach as (
      select s.sent_at, s.responded_at
      from message_sends s join message_presets p on p.id = s.preset_id
      where s.channel = 'sms' and p.type = 'initial_outreach'
    ),
    last_inbound as (
      select agent_id, max(occurred_at) as at from agent_interactions where direction = 'inbound' group by agent_id
    )
    select
      to_char(now() at time zone ${TZ}, 'FMMonth') as month,
      (select coalesce(sum(value), 0) from job, bounds where at >= month_start and at < month_end)::int as booked,
      (select count(*) from job, bounds where at >= month_start and at < month_end)::int as jobs,
      (select avg(value) from job where value > 0)::float as avg_job,
      (select avg(value) from job where nth = 1)::float as first_job,
      (select coalesce(sum(value), 0) from job, bounds where nth > 1 and at >= month_start and at < month_end)::int as repeat_now,
      (select coalesce(sum(value), 0) from job, bounds
        where nth > 1 and at >= month_start - interval '1 month' and at < month_start)::int as repeat_before,
      (select count(*) from (select contact_agent_id, min(created_at) as first from job where contact_agent_id is not null group by 1) f, bounds
        where f.first >= month_start)::int as new_clients,
      (select count(*) from mature)::int as mature_interested,
      (select count(*) from mature where booked)::int as mature_booked,
      (select count(*) from outreach where sent_at > now() - interval '28 days')::int as sent_28,
      (select count(*) from outreach where sent_at > now() - interval '28 days' and responded_at is not null)::int as replied_28,
      (select count(*) from texted where replied)::int as repliers,
      (select count(*) from texted t join agents a on a.id = t.agent_id
        where t.replied and a.relationship_status in ('interested', 'worked_once', 'regular'))::int as repliers_interested,
      (select count(*) from agents a left join last_inbound i on i.agent_id = a.id
        where a.relationship_status = 'interested'
          and greatest(a.last_contacted_at, i.at) > now() - make_interval(days => ${LIVE_DAYS}))::int as interested_live,
      (select count(*) from outreach, bounds where sent_at >= week_start)::int as week_texts,
      (select count(*) from outreach, bounds where sent_at >= day_start)::int as today_texts,
      (select dow from bounds) as dow,
      (select count(*) from outreach, bounds where responded_at >= week_start)::int as week_replies,
      -- A text to someone he had already texted before this week began.
      (select count(*) from agent_interactions x, bounds
        where x.channel = 'text' and x.direction = 'outbound' and x.occurred_at >= week_start
          and exists (
            select 1 from agent_interactions y
            where y.agent_id = x.agent_id and y.direction = 'outbound' and y.occurred_at < week_start
          ))::int as week_follow_ups
  `)]);
  const r = result.rows[0] as Record<string, number | string | null>;
  const n = (key: string) => Number(r[key] ?? 0);

  const booked = n("booked");
  const gap = Math.max(0, MONTHLY_GOAL - booked);
  const avgJob = Math.round(n("avg_job")) || 250;
  const jobsNeeded = Math.ceil(gap / avgJob);

  const reply = n("sent_28") >= 50 ? n("replied_28") / n("sent_28") : DEFAULT_REPLY_RATE;
  const interestedRate = n("repliers") >= 20 ? n("repliers_interested") / n("repliers") : DEFAULT_INTERESTED_RATE;
  const bookSample = { booked: n("mature_booked"), of: n("mature_interested") };
  const bookMeasured = bookSample.of >= MIN_SAMPLE && bookSample.booked > 0;
  const book = bookMeasured ? lowerBound(bookSample.booked, bookSample.of) : ASSUMED_BOOK_RATE;

  // Repeat clients first. This month's figure is thin early in a month, before
  // its jobs are booked, so last month's stands in until it's passed.
  const repeat = n("repeat_now");
  const newRevenue = Math.max(0, MONTHLY_GOAL - Math.max(repeat, n("repeat_before")));
  const firstJob = Math.round(n("first_job")) || avgJob;

  // Then back up the funnel for the rest: new clients → interested agents →
  // replies → texts, a month's worth, spread evenly over its weeks.
  const newClientsPerMonth = newRevenue / firstJob;
  const interestedPerMonth = newClientsPerMonth / book;
  const repliesPerWeek = Math.ceil(interestedPerMonth / Math.max(interestedRate, 0.01) / WEEKS_PER_MONTH);
  const textsPerWeek = Math.ceil(repliesPerWeek / Math.max(reply, 0.01));
  const live = n("interested_live");

  const percent = (rate: number) => `${Math.round(rate * 100)}%`;
  const dollars = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;
  const clients = Math.ceil(newClientsPerMonth);
  const note =
    `The estimate: repeat clients cover ${dollars(MONTHLY_GOAL - newRevenue)} of a month, so new ones need to bring ` +
    `${dollars(newRevenue)}, about ${clients} client${clients === 1 ? "" : "s"} at ${dollars(firstJob)} a first job. ` +
    `${percent(reply)} of texts get a reply, ${percent(interestedRate)} of those turn interested, and ` +
    (bookMeasured
      ? `about 1 in ${Math.round(1 / book)} interested agents books: the cautious end of ${bookSample.booked} of ` +
        `${bookSample.of} so far, counting only people first contacted ${MATURE_DAYS / 7} weeks ago or more.`
      : `1 in ${Math.round(1 / book)} interested agents books (a guess until more of them have had time to).`);

  return {
    goal: MONTHLY_GOAL,
    month: String(r.month),
    booked,
    jobs: n("jobs"),
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
      newClientsThisMonth: n("new_clients"),
      textsPerWeek,
      repliesPerWeek,
    },
    note,
    thisWeek: {
      textsToGo: Math.max(0, textsPerWeek - n("week_texts")),
      repliesToGo: Math.max(0, repliesPerWeek - n("week_replies")),
      texts: n("week_texts"),
      replies: n("week_replies"),
      followUps: n("week_follow_ups"),
      followUpsDue: board.today.length + board.later.length,
    },
    today: {
      texts: n("today_texts"),
      textsTarget: Math.ceil(
        Math.max(0, textsPerWeek - (n("week_texts") - n("today_texts"))) / (n("dow") <= 6 ? 7 - n("dow") : 1)
      ),
    },
  };
}
