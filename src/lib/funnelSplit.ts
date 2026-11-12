import { db } from "@/db";
import { sql } from "drizzle-orm";
import { agentMarkets } from "@/lib/agentMarket";
import { marketFor, type Market } from "@/lib/markets";
import { FEED_STATS_DAYS, getFeedStatsWithTotal, type FeedStats } from "@/app/follow-up/feeds/stats";

/** The Cold row: agents texted, how many answered, how many are interested or better. */
export interface ColdStats {
  reached: number;
  replied: number;
  interested: number;
}

/**
 * The Home funnel card's two rows, over the last FEED_STATS_DAYS, overall and
 * split by market (the card's Local / Regional / Portland tabs):
 *
 * - **Cold**: agents whose first outreach text (an initial_outreach template)
 *   went out in the window. Replied = any of those texts answered; interested
 *   = they're interested or a client now (they started cold, so any of that
 *   came after the text).
 * - **Follow up**: agents reached from a Follow Up card in the window, once
 *   each (feeds/stats.ts). Replied within a week; interested = warm when
 *   reached and turned interested or better since.
 *
 * `byMarket` holds the same numbers three ways: every cold agent is placed by
 * the listing on their first outreach text, or — when that send has no listing
 * — by their agent market (lib/agentMarket.ts), and the follow-up row is
 * feeds.allByMarket, so the three markets always add back up to `followUp`
 * and to `cold`.
 */
export interface FunnelSplit {
  days: number;
  cold: ColdStats;
  followUp: FeedStats;
  byMarket: Record<Market, { cold: ColdStats; followUp: FeedStats }>;
}

const emptyCold = (): ColdStats => ({ reached: 0, replied: 0, interested: 0 });

/** Statuses that count as "turned interested" (a booking skips straight past it). */
const INTERESTED_OR_BETTER = new Set(["interested", "worked_once", "regular"]);

/** One row per agent texted in the window, with the listing on their first text. */
interface ColdRow {
  agent_id: string;
  replied: boolean;
  relationship_status: string;
  /** The listing of the first send — null for a cold-email import or a manual text. */
  listing_id: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  geocode_source: string | null;
}

export async function computeFunnelSplit(): Promise<FunnelSplit> {
  const [coldRows, feeds] = await Promise.all([
    db.execute(sql`
      with texted as (
        select
          s.agent_id,
          min(s.sent_at) as first_text,
          bool_or(s.responded_at is not null) as replied,
          -- The listing he was texted about, from that first text, so the
          -- market is where the outreach happened rather than where the
          -- agent's newest listing is.
          (array_agg(s.listing_id order by s.sent_at))[1] as listing_id
        from message_sends s join message_presets p on p.id = s.preset_id
        where s.channel = 'sms' and p.type = 'initial_outreach' and s.agent_id is not null
        group by s.agent_id
      )
      select
        t.agent_id,
        t.replied,
        a.relationship_status,
        t.listing_id,
        l.city,
        l.state,
        l.lat,
        l.lng,
        l.geocode_source
      from texted t
      join agents a on a.id = t.agent_id
      left join listings l on l.id = t.listing_id
      where t.first_text > now() - make_interval(days => ${FEED_STATS_DAYS})
    `),
    getFeedStatsWithTotal(),
  ]);
  const rows = coldRows.rows as unknown as ColdRow[];

  // Texts sent with no listing on them (cold-email imports, manual sends) fall
  // back to the agent's own market, one query for just those ids.
  const fallback = await agentMarkets(rows.filter((r) => r.listing_id == null).map((r) => r.agent_id));

  const cold = emptyCold();
  const byMarket: FunnelSplit["byMarket"] = {
    local: { cold: emptyCold(), followUp: feeds.allByMarket.local },
    regional: { cold: emptyCold(), followUp: feeds.allByMarket.regional },
    portland: { cold: emptyCold(), followUp: feeds.allByMarket.portland },
  };

  for (const row of rows) {
    const market =
      row.listing_id == null
        ? fallback.get(row.agent_id) ?? "regional"
        : marketFor({
            city: row.city,
            state: row.state,
            lat: row.lat,
            lng: row.lng,
            geocodeSource: row.geocode_source,
          });
    const replied = row.replied ? 1 : 0;
    const interested = INTERESTED_OR_BETTER.has(row.relationship_status) ? 1 : 0;
    for (const entry of [cold, byMarket[market].cold]) {
      entry.reached++;
      entry.replied += replied;
      entry.interested += interested;
    }
  }

  return { days: FEED_STATS_DAYS, cold, followUp: feeds.all, byMarket };
}
