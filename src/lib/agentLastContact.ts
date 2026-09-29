import { db } from "@/db";
import { agentInteractions, messageSends, type Agent } from "@/db/schema";
import { isNotNull } from "drizzle-orm";

/**
 * Returns the agents with lastContactedAt / lastContactedListingId set from
 * their contact history — exactly what the agent's "Contact history" list
 * shows: every send in message_sends and every agent_interactions row, in
 * either direction. An agent with an empty history gets null, so the
 * "Already contacted" badge (which just checks lastContactedAt) shows if
 * and only if that list has anything in it.
 *
 * The stored stamp on the agents row is deliberately ignored here: it's
 * written from a dozen places and drifted both ways — badges missing for
 * agents with real history, and badges shown for agents with none.
 */
export async function withLastContactFromHistory(allAgents: Agent[]): Promise<Agent[]> {
  const [sends, interactions] = await Promise.all([
    db
      .select({ agentId: messageSends.agentId, at: messageSends.sentAt, listingId: messageSends.listingId })
      .from(messageSends)
      .where(isNotNull(messageSends.agentId)),
    db
      .select({ agentId: agentInteractions.agentId, at: agentInteractions.occurredAt, listingId: agentInteractions.listingId })
      .from(agentInteractions),
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
    return { ...agent, lastContactedAt: contact?.at ?? null, lastContactedListingId: contact?.listingId ?? null };
  });
}
