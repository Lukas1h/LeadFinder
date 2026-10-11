// The monthly goal, worked backwards into what to do this week.
//
// The method is the usual sales one — money wanted ÷ price = jobs, jobs ÷ close
// rate = leads, leads ÷ reply rate = messages — with two changes for how this
// business actually runs. There is no sales call: the steps are text → reply →
// interested → job. And the first two rates are measured from the texts
// already sent, so they move as the outreach does; only the last one is a
// guess, because as of 2026-10-10 no text had yet turned into a booking (every
// job so far came some other way, and most texts were under three weeks old).
//
// Deliberately the conservative end: jobs from people who already book him
// aren't assumed, so anything they bring in shrinks the numbers rather than
// being counted on.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getFollowUpBoard } from "@/app/follow-up/data";

/** Dollars of booked work a month. Change it here. */
export const MONTHLY_GOAL = 3000;

/** Used until the texts have produced enough bookings to measure it. Lukas's own estimate (2026-10-10): about 1 in 50 interested agents. */
const ASSUMED_BOOK_RATE = 0.02;
/** Bookings from texted agents before the measured rate replaces the assumed one. */
const MIN_BOOKINGS_TO_MEASURE = 3;
/** Fallbacks for a rate with too little behind it to trust. */
const DEFAULT_REPLY_RATE = 0.25;
const DEFAULT_INTERESTED_RATE = 0.2;
/** An interested agent counts toward the goal only if there has been contact, either way, this recently. */
const LIVE_DAYS = 30;
/** The rest of the month is never treated as shorter than this, so the last week doesn't ask for a month of texts. */
const MIN_WEEKS_LEFT = 2;

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
    book: number;
    /** False while `book` is the assumed 1 in 10. */
    bookMeasured: boolean;
  };
  /** Interested agents in touch in the last 30 days, and how many the gap takes. */
  interested: { live: number; needed: number };
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
}

export async function computeGoalProgress(): Promise<GoalProgress> {
  const [board, result] = await Promise.all([getFollowUpBoard(), db.execute(sql`
    with bounds as (
      select
        date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ} as month_start,
        (date_trunc('month', now() at time zone ${TZ}) + interval '1 month') at time zone ${TZ} as month_end,
        date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ} as week_start
    ),
    job as (
      select b.id, b.contact_agent_id, coalesce(b.job_date, b.created_at) as at,
        (select coalesce(sum(amount), 0) from booking_line_items li where li.booking_id = b.id) as value
      from bookings b
    ),
    -- First outreach text per agent, and whether any of them was answered.
    texted as (
      select s.agent_id, min(s.sent_at) as first_text, bool_or(s.responded_at is not null) as replied
      from message_sends s join message_presets p on p.id = s.preset_id
      where s.channel = 'sms' and p.type = 'initial_outreach' and s.agent_id is not null
      group by s.agent_id
    ),
    won as (
      select distinct t.agent_id from texted t join job j on j.contact_agent_id = t.agent_id and j.at > t.first_text
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
      extract(epoch from (select month_end from bounds) - now()) / 604800.0 as weeks_left,
      (select coalesce(sum(value), 0) from job, bounds where at >= month_start and at < month_end)::int as booked,
      (select count(*) from job, bounds where at >= month_start and at < month_end)::int as jobs,
      (select avg(value) from job where value > 0)::float as avg_job,
      (select count(*) from outreach where sent_at > now() - interval '28 days')::int as sent_28,
      (select count(*) from outreach where sent_at > now() - interval '28 days' and responded_at is not null)::int as replied_28,
      (select count(*) from texted where replied)::int as repliers,
      (select count(*) from texted t join agents a on a.id = t.agent_id
        where t.replied and a.relationship_status in ('interested', 'worked_once', 'regular'))::int as repliers_interested,
      (select count(*) from texted t join agents a on a.id = t.agent_id
        where a.relationship_status = 'interested' or t.agent_id in (select agent_id from won))::int as texted_interested_ever,
      (select count(*) from won)::int as texted_booked,
      (select count(*) from agents a left join last_inbound i on i.agent_id = a.id
        where a.relationship_status = 'interested'
          and greatest(a.last_contacted_at, i.at) > now() - make_interval(days => ${LIVE_DAYS}))::int as interested_live,
      (select count(*) from outreach, bounds where sent_at >= week_start)::int as week_texts,
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
  const bookMeasured = n("texted_booked") >= MIN_BOOKINGS_TO_MEASURE;
  const book = bookMeasured ? n("texted_booked") / Math.max(1, n("texted_interested_ever")) : ASSUMED_BOOK_RATE;

  // Back up the funnel: jobs → interested agents → replies → texts. The
  // interested agents he is already talking to come off the top.
  const interestedNeeded = Math.ceil(jobsNeeded / book);
  const live = n("interested_live");
  const newInterested = Math.max(0, interestedNeeded - live);
  const repliesNeeded = newInterested / Math.max(interestedRate, 0.01);
  const textsNeeded = repliesNeeded / Math.max(reply, 0.01);
  const weeks = Math.max(MIN_WEEKS_LEFT, n("weeks_left"));

  return {
    goal: MONTHLY_GOAL,
    month: String(r.month),
    booked,
    jobs: n("jobs"),
    gap,
    avgJob,
    jobsNeeded,
    rates: { reply, interested: interestedRate, book, bookMeasured },
    interested: { live, needed: interestedNeeded },
    thisWeek: {
      textsToGo: Math.ceil(textsNeeded / weeks),
      repliesToGo: Math.ceil(repliesNeeded / weeks),
      texts: n("week_texts"),
      replies: n("week_replies"),
      followUps: n("week_follow_ups"),
      followUpsDue: board.news.length + board.justListed.length + board.agents.length,
    },
  };
}
