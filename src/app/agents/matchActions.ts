"use server";

import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq, ilike, isNotNull, and, desc } from "drizzle-orm";
import { nameSimilarity, FUZZY_MATCH_THRESHOLD } from "@/lib/agentMatch";

export interface AgentMatchSummary {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  lastContactedAt: Date | null;
  relationshipStatus: string;
  declinedAt: Date | null;
}

export interface AgentMatchResult {
  exactEmailMatch: AgentMatchSummary | null;
  fuzzyMatches: AgentMatchSummary[];
}

const SELECT_COLUMNS = {
  id: agents.id,
  name: agents.name,
  phone: agents.phone,
  email: agents.email,
  lastContactedAt: agents.lastContactedAt,
  relationshipStatus: agents.relationshipStatus,
  declinedAt: agents.declinedAt,
};

/**
 * Powers the Compose-email duplicate-contact warning. An exact email match
 * is certain (same email = same person) so it's returned separately and
 * never needs a merge decision — it's just "you already have this contact."
 * Fuzzy name matches are possible-but-uncertain, so the caller must get
 * explicit confirmation before merging one into sendComposeEmail's
 * matchedAgentId (see composeEmailActions.ts) — a wrong auto-merge would
 * silently pollute an unrelated agent's contact history.
 */
export async function findAgentMatches(name: string, email: string): Promise<AgentMatchResult> {
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName = name.trim();

  const [exactEmailMatch] = trimmedEmail
    ? await db.select(SELECT_COLUMNS).from(agents).where(eq(agents.email, trimmedEmail))
    : [];

  if (exactEmailMatch) {
    return { exactEmailMatch, fuzzyMatches: [] };
  }

  if (!trimmedName) {
    return { exactEmailMatch: null, fuzzyMatches: [] };
  }

  const all = await db.select(SELECT_COLUMNS).from(agents);
  const fuzzyMatches = all
    .filter((a) => a.name && nameSimilarity(trimmedName, a.name) >= FUZZY_MATCH_THRESHOLD)
    .sort((a, b) => nameSimilarity(trimmedName, b.name!) - nameSimilarity(trimmedName, a.name!))
    .slice(0, 5);

  return { exactEmailMatch: null, fuzzyMatches };
}

/**
 * Powers the Compose-email Name field's autocomplete — a plain substring
 * match (not the fuzzy scorer above, which is tuned for "is this the same
 * person" merge decisions, not live-typing suggestions) against agents who
 * have a name on file. Ordered by most recently contacted first so a
 * realtor Lukas has actually worked with surfaces before a same-named
 * stranger.
 */
export async function searchAgentsByName(query: string): Promise<AgentMatchSummary[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  return db
    .select(SELECT_COLUMNS)
    .from(agents)
    .where(and(isNotNull(agents.name), ilike(agents.name, `%${trimmed}%`)))
    .orderBy(desc(agents.lastContactedAt))
    .limit(8);
}

/** Powers the "Email" contact button's deep link into Compose (?agent=<id>) — prefills name/email. */
export async function getAgentContactInfo(id: string): Promise<{ name: string | null; email: string | null } | null> {
  const [agent] = await db.select({ name: agents.name, email: agents.email }).from(agents).where(eq(agents.id, id));
  return agent ?? null;
}

/**
 * Merges a fuzzy-matched agent's email/name live, the moment the user
 * clicks "Merge" in Compose's duplicate-contact banner — not deferred
 * until an actual send (the previous behavior), since confirming "yes,
 * this is the same person" shouldn't be contingent on a send that might
 * fail or get abandoned. Deliberately does NOT touch lastContactedAt —
 * merging isn't itself a contact.
 */
export async function mergeAgentEmail(agentId: string, name: string, email: string): Promise<void> {
  await db
    .update(agents)
    .set({ email: email.trim().toLowerCase(), name: name.trim() })
    .where(eq(agents.id, agentId));
}
