import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { inArray, sql } from "drizzle-orm";
import { refreshLeadSections } from "@/lib/leadSections";
import { MAX_COLD_FOLLOW_UPS } from "./pool";

/**
 * "Ignored" (Lukas, 2026-11-15): a cold agent who got the first text and the
 * cold follow-up after it (MAX_COLD_FOLLOW_UPS, from a cold_* Follow Up tab)
 * and still hasn't answered IGNORE_AFTER_DAYS after that follow-up. Like
 * declined, they leave every outreach list; unlike declined, they never said
 * no, so a reply later moves them back in (bumpAgentRelationshipOnMilestone).
 *
 * Run nightly from /api/cron/market-status. The status change is logged by
 * the agent_status_changes trigger like every other one.
 */
export const IGNORE_AFTER_DAYS = 3;

export async function markIgnoredAgents(): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    update ${agents} a
       set relationship_status = 'ignored', ignored_at = now()
     where a.relationship_status = 'cold'
       and a.declined_at is null
       and (
         select count(*) from agent_interactions i
          where i.agent_id = a.id and i.direction = 'outbound'
            and i.pending_since is null
            and (i.outcome is null or i.outcome <> 'not_sent')
            and left(i.follow_up_feed, 5) = 'cold_'
       ) >= ${MAX_COLD_FOLLOW_UPS}
       and (
         select max(i.occurred_at) from agent_interactions i
          where i.agent_id = a.id and i.direction = 'outbound'
            and i.pending_since is null
            and (i.outcome is null or i.outcome <> 'not_sent')
            and left(i.follow_up_feed, 5) = 'cold_'
       ) < now() - interval '${sql.raw(String(IGNORE_AFTER_DAYS))} days'
       and not exists (
         select 1 from agent_interactions r
          where r.agent_id = a.id and r.direction = 'inbound'
       )
    returning a.id`);
  const ids = rows.rows.map((r) => r.id);
  // Their listings move from Texted before to Unlikely; keep the stored
  // section honest for template targeting.
  if (ids.length > 0) {
    const theirs = await db.select({ id: listings.id }).from(listings).where(inArray(listings.agentId, ids));
    await refreshLeadSections(theirs.map((l) => l.id));
  }
  return ids;
}
