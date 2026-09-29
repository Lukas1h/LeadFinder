import { db } from "@/db";
import { agentInteractions, messageSends, type Agent } from "@/db/schema";
import { and, eq, isNull, isNotNull } from "drizzle-orm";

/**
 * Returns the agents with lastContactedAt / lastContactedListingId taken
 * from the real contact history — every send in message_sends and every
 * settled outbound interaction — instead of trusting the stored stamp.
 *
 * The stamp is written in a dozen places (sends, email compose, logged
 * calls, call-offs, backfills, agent merges) and some of them miss it: on
 * 2026-09-29 four agents with logged calls and cold emails had no stamp at
 * all, and two more had a stamp pointing at a listing they were never
 * messaged about. The "Already contacted" badge reads these two fields, so
 * a drifted stamp meant a missing badge. History wins whenever it has
 * anything; the stored stamp is only the fallback for agents with none.
 */
export async function withLastContactFromHistory(allAgents: Agent[]): Promise<Agent[]> {
  const [sends, interactions] = await Promise.all([
    db
      .select({ agentId: messageSends.agentId, at: messageSends.sentAt, listingId: messageSends.listingId })
      .from(messageSends)
      .where(isNotNull(messageSends.agentId)),
    db
      .select({ agentId: agentInteractions.agentId, at: agentInteractions.occurredAt, listingId: agentInteractions.listingId })
      .from(agentInteractions)
      .where(and(eq(agentInteractions.direction, "outbound"), isNull(agentInteractions.pendingSince))),
  ]);

  const latest = new Map<string, { at: Date; listingId: string | null }>();
  for (const row of [...sends, ...interactions]) {
    if (!row.agentId) continue;
    const current = latest.get(row.agentId);
    // On a tie (a send and the interaction it produced), keep whichever
    // names a listing.
    if (!current || row.at > current.at || (row.at.getTime() === current.at.getTime() && !current.listingId)) {
      latest.set(row.agentId, { at: row.at, listingId: row.listingId });
    }
  }

  return allAgents.map((agent) => {
    const contact = latest.get(agent.id);
    return contact ? { ...agent, lastContactedAt: contact.at, lastContactedListingId: contact.listingId } : agent;
  });
}
