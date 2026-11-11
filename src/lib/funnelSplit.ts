import { db } from "@/db";
import { sql } from "drizzle-orm";
import { FEED_STATS_DAYS, getFeedStatsWithTotal, type FeedStats } from "@/app/follow-up/feeds/stats";

/**
 * The Home funnel card's two rows, over the last FEED_STATS_DAYS:
 *
 * - **Cold**: agents whose first outreach text (an initial_outreach template)
 *   went out in the window. Replied = any of those texts answered; interested
 *   = they're interested or a client now (they started cold, so any of that
 *   came after the text).
 * - **Follow up**: agents reached from a Follow Up card in the window, once
 *   each (feeds/stats.ts). Replied within a week; interested = warm when
 *   reached and turned interested or better since.
 */
export interface FunnelSplit {
  days: number;
  cold: { reached: number; replied: number; interested: number };
  followUp: FeedStats;
}

export async function computeFunnelSplit(): Promise<FunnelSplit> {
  const [cold, feeds] = await Promise.all([
    db.execute(sql`
      with texted as (
        select s.agent_id, min(s.sent_at) as first_text, bool_or(s.responded_at is not null) as replied
        from message_sends s join message_presets p on p.id = s.preset_id
        where s.channel = 'sms' and p.type = 'initial_outreach' and s.agent_id is not null
        group by s.agent_id
      )
      select
        count(*)::int as reached,
        count(*) filter (where t.replied)::int as replied,
        count(*) filter (where a.relationship_status in ('interested', 'worked_once', 'regular'))::int as interested
      from texted t join agents a on a.id = t.agent_id
      where t.first_text > now() - make_interval(days => ${FEED_STATS_DAYS})
    `),
    getFeedStatsWithTotal(),
  ]);
  const row = cold.rows[0] as { reached: number; replied: number; interested: number };
  return {
    days: FEED_STATS_DAYS,
    cold: { reached: Number(row.reached), replied: Number(row.replied), interested: Number(row.interested) },
    followUp: feeds.all,
  };
}
