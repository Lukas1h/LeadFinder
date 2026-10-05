import { db } from "@/db";
import { agentInteractions, messageSends, type Agent } from "@/db/schema";
import { and, eq, inArray, isNotNull, max } from "drizzle-orm";

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

export interface ContactByChannel {
  /** Latest text or call (sends and logged interactions). */
  texted: Date | null;
  /** Latest email. */
  emailed: Date | null;
}

/**
 * Latest outbound contact per agent, split into texting/calling vs email.
 * Kept apart because nearly every agent was in the big cold email run, and
 * that doesn't make a first text any less of a cold first text — the data
 * shows the same ~26% reply rate either way (2026-10-05). Inbound replies
 * aren't counted; they're the agent reaching out, not Lukas.
 */
export async function contactByChannel(agentIds: string[]): Promise<Map<string, ContactByChannel>> {
  const result = new Map<string, ContactByChannel>();
  if (agentIds.length === 0) return result;
  const [sends, interactions] = await Promise.all([
    db
      .select({ agentId: messageSends.agentId, channel: messageSends.channel, at: max(messageSends.sentAt) })
      .from(messageSends)
      .where(inArray(messageSends.agentId, agentIds))
      .groupBy(messageSends.agentId, messageSends.channel),
    db
      .select({ agentId: agentInteractions.agentId, channel: agentInteractions.channel, at: max(agentInteractions.occurredAt) })
      .from(agentInteractions)
      .where(and(inArray(agentInteractions.agentId, agentIds), eq(agentInteractions.direction, "outbound")))
      .groupBy(agentInteractions.agentId, agentInteractions.channel),
  ]);
  for (const r of [...sends, ...interactions]) {
    if (!r.agentId || !r.at) continue;
    const at = new Date(r.at);
    const entry = result.get(r.agentId) ?? { texted: null, emailed: null };
    const key = r.channel === "email" ? "emailed" : "texted";
    if (!entry[key] || at > entry[key]!) entry[key] = at;
    result.set(r.agentId, entry);
  }
  return result;
}
