import { db } from "@/db";
import { agentInteractions, agents, type Agent } from "@/db/schema";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";

/**
 * The cold pool: agents Lukas texted once, who never answered, and who have
 * been quiet long enough to hear from him again.
 *
 * These are not Follow up cards. Every Follow up feed is aimed at people he
 * has a relationship with (warm, interested, clients); this is the opposite
 * end of the list — a cold text that got no reply — and the only thing that
 * earns a second text is a fresh excuse: a shoot near their listing, a job in
 * their area, or a listing they put up since.
 *
 * Read-only by design (SELECTs only): it decides who is due, and the send
 * itself stays a deliberate action.
 */

export interface ColdPoolAgent {
  agent: Agent;
  firstTextedAt: Date;
  lastTextedAt: Date;
  /** Latest outbound interaction of any channel. */
  lastContactAt: Date;
  /** Outbound interactions started from a cold_* follow-up feed. */
  coldFollowUpsSent: number;
  /** First texted before 2026-10-05 Pacific: the samples email was still news to them. */
  samplesAskEligible: boolean;
}

/** Nobody comes up before this many days of silence. */
export const MIN_GAP_DAYS = 21;
/**
 * One cold follow-up on top of the first text (Lukas, 2026-11-15). No reply
 * IGNORE_AFTER_DAYS after it and the agent is marked "ignored" (ignore.ts).
 */
export const MAX_COLD_FOLLOW_UPS = 1;

/** Why a cold agent is worth one more text: the excuse the first text leads with (triggers.ts). Strongest first. */
export const COLD_TRIGGERS = ["near_shoot", "in_area", "new_listing"] as const;
export type ColdTrigger = (typeof COLD_TRIGGERS)[number];

/**
 * The triggers the Cold tabs draw candidates from (coldFollowUps.ts). All
 * three since 2026-11-15: a home he just shot near their listing or a job in
 * their area is the strongest excuse he has, and a shoot marked Showcase (see
 * nearShoots.ts) also earns the "can I share a few pics?" pitch. Both shoot
 * triggers still find a non-Showcase shoot too; it just gets the soft pitch.
 */
export const ENABLED_COLD_TRIGGERS: ColdTrigger[] = ["near_shoot", "in_area", "new_listing"];

/**
 * The cold Follow up tabs, one per pitch: every card on a tab sends the same
 * second text. A cold text records one of these in
 * `agentInteractions.followUpFeed`, which is how each tab's stats measure its
 * pitch (feeds/stats.ts). The trigger above is a group inside the tab.
 */
export const COLD_FEED_KEYS = [
  "cold_showcase",
  "cold_samples",
  "cold_video",
  "cold_turnaround",
  "cold_soft",
] as const;
export type ColdFeedKey = (typeof COLD_FEED_KEYS)[number];

const DAY = 24 * 60 * 60 * 1000;

/**
 * 2026-10-05 00:00 Pacific (PDT, UTC-7). An agent first texted before this
 * never got the "can I send samples?" ask when it went out, so it is still a
 * natural thing to offer them.
 */
const SAMPLES_CUTOFF = new Date("2026-10-05T07:00:00.000Z");

/**
 * A text that actually went out: outbound, confirmed (not parked pending), and
 * not marked "didn't send". `outcome` null is a text whose result was never
 * recorded, which counts.
 */
const REAL_OUTBOUND = sql`${agentInteractions.direction} = 'outbound' and ${agentInteractions.pendingSince} is null and (${agentInteractions.outcome} is null or ${agentInteractions.outcome} <> 'not_sent')`;

const TEXT_OUTBOUND = sql`${agentInteractions.channel} = 'text' and ${REAL_OUTBOUND}`;

/** An aggregate timestamp as epoch milliseconds (no driver date parsing to rely on). */
function epochMs(value: SQL): SQL<number | string | null> {
  return sql<number | string | null>`extract(epoch from (${value})) * 1000`;
}

function millis(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Everyone in the cold pool as of `now`: cold, never declined, texted at least
 * once for real, never replied by any channel, silent for MIN_GAP_DAYS, and
 * with fewer than MAX_COLD_FOLLOW_UPS cold follow-ups already sent.
 *
 * One grouped query over agents and their interactions, not one per agent.
 */
export async function loadColdPool(now = Date.now()): Promise<ColdPoolAgent[]> {
  const cutoff = now - MIN_GAP_DAYS * DAY;

  const rows = await db
    .select({
      agent: agents,
      firstTextedMs: epochMs(sql`min(${agentInteractions.occurredAt}) filter (where ${TEXT_OUTBOUND})`),
      lastTextedMs: epochMs(sql`max(${agentInteractions.occurredAt}) filter (where ${TEXT_OUTBOUND})`),
      lastContactMs: epochMs(sql`max(${agentInteractions.occurredAt}) filter (where ${REAL_OUTBOUND})`),
      // Every interaction the agent has, so an inbound one anywhere disqualifies them.
      inboundCount: sql<number>`count(*) filter (where ${agentInteractions.direction} = 'inbound')::int`,
      coldFollowUpsSent: sql<number>`count(*) filter (where ${REAL_OUTBOUND} and left(coalesce(${agentInteractions.followUpFeed}, ''), 5) = 'cold_')::int`,
    })
    .from(agents)
    .innerJoin(agentInteractions, eq(agentInteractions.agentId, agents.id))
    .where(and(eq(agents.relationshipStatus, "cold"), isNull(agents.declinedAt)))
    .groupBy(agents.id);

  const pool: ColdPoolAgent[] = [];
  for (const row of rows) {
    const first = millis(row.firstTextedMs);
    const last = millis(row.lastTextedMs);
    const contact = millis(row.lastContactMs);
    // An inner join plus these checks is the "at least one real text out" rule.
    if (first == null || last == null || contact == null) continue;
    if (Number(row.inboundCount) > 0) continue;
    if (contact > cutoff) continue;
    if (Number(row.coldFollowUpsSent) >= MAX_COLD_FOLLOW_UPS) continue;

    pool.push({
      agent: row.agent,
      firstTextedAt: new Date(first),
      lastTextedAt: new Date(last),
      lastContactAt: new Date(contact),
      coldFollowUpsSent: Number(row.coldFollowUpsSent),
      samplesAskEligible: first < SAMPLES_CUTOFF.getTime(),
    });
  }

  // Longest silence first — the same order the dry run reads in.
  pool.sort((a, b) => a.lastTextedAt.getTime() - b.lastTextedAt.getTime());
  return pool;
}
