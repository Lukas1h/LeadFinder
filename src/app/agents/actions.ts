"use server";

import { db } from "@/db";
import {
  agents,
  listings,
  messageSends,
  messagePresets,
  type Agent,
  type Listing,
  type AgentRelationshipStatus,
  type MessageChannel,
  type PresetType,
  type MessageResult,
} from "@/db/schema";
import { eq, isNotNull, isNull, sql, desc, and, ne, or, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { findFirstResultUrl, findFirstNameMatchResultUrl } from "@/lib/tavily";

/**
 * Idempotent — inserts an Agent row for every unique agentPhone found
 * across all listings that doesn't already have one. Never overwrites an
 * existing row, so it's safe to call on every page load (existing manual
 * edits/imports are untouched). If a phone's listings include one that's
 * currently "declined", the new row is seeded already-declined (using that
 * listing's statusChangedAt) so it starts in the right section immediately
 * instead of waiting for the next status change to touch it.
 *
 * Finds the missing phones with a LEFT JOIN rather than fetching every
 * listing plus every agent phone into JS and diffing there — with
 * thousands of agent rows on file, that second full-table fetch on every
 * single page load was real, wasted latency for a check that's a no-op
 * almost every time (there's nothing new to backfill).
 */
export async function ensureAgentsBackfilled() {
  const rows = await db
    .select({
      agentPhone: listings.agentPhone,
      agentName: listings.agentName,
      status: listings.status,
      statusChangedAt: listings.statusChangedAt,
    })
    .from(listings)
    .leftJoin(agents, eq(agents.phone, listings.agentPhone))
    .where(and(isNotNull(listings.agentPhone), isNull(agents.id)));

  const byPhone = new Map<string, { name: string | null; declinedAt: Date | null }>();
  for (const r of rows) {
    const phone = r.agentPhone;
    if (!phone) continue;
    const existing = byPhone.get(phone) ?? { name: null, declinedAt: null };
    if (!existing.name && r.agentName) existing.name = r.agentName;
    if (r.status === "declined" && r.statusChangedAt) {
      if (!existing.declinedAt || r.statusChangedAt > existing.declinedAt) {
        existing.declinedAt = r.statusChangedAt;
      }
    }
    byPhone.set(phone, existing);
  }

  if (byPhone.size === 0) return;

  const toInsert = [...byPhone.entries()].map(([phone, data]) => ({
    phone,
    name: data.name,
    declinedAt: data.declinedAt,
  }));
  await db.insert(agents).values(toInsert).onConflictDoNothing({ target: agents.phone });
}

export async function updateAgentRelationshipStatus(id: string, status: AgentRelationshipStatus) {
  await db.update(agents).set({ relationshipStatus: status }).where(eq(agents.id, id));
  revalidatePath("/agents");
}

/** Clears declinedAt — moves an agent back out of the declined section. */
export async function reconnectAgent(id: string) {
  await db.update(agents).set({ declinedAt: null }).where(eq(agents.id, id));
  revalidatePath("/agents");
}

/** Manually flag an agent declined, for imported agents with no listing to infer it from. */
export async function markAgentDeclined(id: string) {
  await db.update(agents).set({ declinedAt: new Date() }).where(eq(agents.id, id));
  revalidatePath("/agents");
}

export async function updateAgentNotes(id: string, notes: string) {
  await db.update(agents).set({ notes: notes.trim() || null }).where(eq(agents.id, id));
  revalidatePath("/agents");
}

function normalizePhone(phone: string): string {
  return phone.trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ContactInfoResult {
  error?: string;
  phone?: string | null;
  email?: string | null;
}

/** Shared by importAgent and updateAgentContactInfo — at least one of phone/email required, both format-checked. */
function parseContactInfo(phoneInput: string, emailInput: string): ContactInfoResult {
  const trimmedPhone = phoneInput.trim();
  const trimmedEmail = emailInput.trim().toLowerCase();
  if (!trimmedPhone && !trimmedEmail) return { error: "Enter a phone number or an email" };

  let phone: string | null = null;
  if (trimmedPhone) {
    phone = normalizePhone(trimmedPhone);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return { error: "Enter a valid phone number" };
  }
  let email: string | null = null;
  if (trimmedEmail) {
    if (!EMAIL_RE.test(trimmedEmail)) return { error: "Enter a valid email address" };
    email = trimmedEmail;
  }

  return { phone, email };
}

export async function importAgent(input: {
  name: string;
  phone: string;
  email: string;
  relationshipStatus: AgentRelationshipStatus;
}) {
  const parsed = parseContactInfo(input.phone, input.email);
  if (parsed.error) return { error: parsed.error };
  const { phone, email } = parsed;

  if (phone) {
    const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.phone, phone));
    if (existing) return { error: "An agent with this phone number already exists" };
  }
  if (email) {
    const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.email, email));
    if (existing) return { error: "An agent with this email already exists" };
  }

  await db.insert(agents).values({
    phone,
    email,
    name: input.name.trim() || null,
    relationshipStatus: input.relationshipStatus,
  });

  revalidatePath("/agents");
  return { error: null };
}

/** Edits an existing agent's name/phone/email/relationship — from the "Edit" control in AgentDetailDialog. */
export async function updateAgentContactInfo(
  id: string,
  input: { name: string; phone: string; email: string; relationshipStatus: AgentRelationshipStatus }
): Promise<{ error: string | null }> {
  const parsed = parseContactInfo(input.phone, input.email);
  if (parsed.error) return { error: parsed.error };
  const { phone, email } = parsed;

  if (phone) {
    const [existing] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.phone, phone), ne(agents.id, id)));
    if (existing) return { error: "Another agent already has this phone number" };
  }
  if (email) {
    const [existing] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.email, email), ne(agents.id, id)));
    if (existing) return { error: "Another agent already has this email" };
  }

  await db
    .update(agents)
    .set({ name: input.name.trim() || null, phone, email, relationshipStatus: input.relationshipStatus })
    .where(eq(agents.id, id));

  revalidatePath("/agents");
  return { error: null };
}

/**
 * Saves the manually-entered business-volume stats from the agent edit
 * form — see the avgListingsPerYear/avgListingPrice comment in schema.ts.
 * Kept separate from updateAgentContactInfo since these aren't contact
 * info and have no validation to share with it (a blank field just clears
 * the stat).
 */
export async function updateAgentStats(
  id: string,
  input: { avgListingsPerYear: number | null; avgListingPrice: number | null }
) {
  await db
    .update(agents)
    .set({ avgListingsPerYear: input.avgListingsPerYear, avgListingPrice: input.avgListingPrice })
    .where(eq(agents.id, id));
  revalidatePath("/agents");
}

/**
 * Permanently deletes an agent — the "Delete" control in AgentDetailDialog's
 * edit form, same directness as deleteBooking. bookings.contactAgentId and
 * messageSends.agentId both cascade to null on delete (see schema.ts), so
 * those records survive, just unlinked — the confirmation dialog spells
 * this out rather than letting it be a surprise. A listing that still
 * carries this agent's phone in its own agentName/agentPhone columns is
 * untouched (they're plain text, not a foreign key), so
 * ensureAgentsBackfilled will recreate a bare profile for that phone next
 * time the Agents page loads.
 */
export async function deleteAgent(id: string) {
  await db.delete(agents).where(eq(agents.id, id));
  revalidatePath("/agents");
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/booked");
  revalidatePath("/messaging");
}

/**
 * Fills in agent info for a listing Zillapi returned with none at all (see
 * ListingModal's "Add agent" prompt) — sets the listing's own
 * agentName/agentPhone/brokerName columns, the same ones Zillapi would have
 * populated, and creates or reuses an Agent row for that phone. Reuses
 * rather than errors on an existing match (unlike importAgent) — linking a
 * listing to an agent already in the system from another lead should never
 * be blocked, it should just fill in whatever gaps that existing row has.
 */
export async function linkAgentToListing(
  listingId: string,
  input: { name: string; phone: string; email: string; brokerName: string }
): Promise<{ error: string | null }> {
  const phone = normalizePhone(input.phone.trim());
  const digits = phone.replace(/\D/g, "");
  if (!phone || digits.length < 10) return { error: "Enter a valid phone number" };

  const trimmedEmail = input.email.trim().toLowerCase();
  if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) return { error: "Enter a valid email address" };
  const typedEmail = trimmedEmail || null;
  const typedName = input.name.trim() || null;
  const brokerName = input.brokerName.trim() || null;

  const [existing] = await db.select().from(agents).where(eq(agents.phone, phone));
  const resolvedName = existing?.name ?? typedName;
  const resolvedEmail = existing?.email ?? typedEmail;

  if (resolvedEmail && resolvedEmail !== existing?.email) {
    const [conflict] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        existing ? and(eq(agents.email, resolvedEmail), ne(agents.id, existing.id)) : eq(agents.email, resolvedEmail)
      );
    if (conflict) return { error: "Another agent already has this email" };
  }

  if (existing) {
    await db.update(agents).set({ name: resolvedName, email: resolvedEmail }).where(eq(agents.id, existing.id));
  } else {
    await db.insert(agents).values({ phone, email: resolvedEmail, name: resolvedName });
  }

  await db.update(listings).set({ agentName: resolvedName, agentPhone: phone, brokerName }).where(eq(listings.id, listingId));

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/agents");
  return { error: null };
}

export interface AgentWithListings {
  agent: Agent;
  listings: Listing[];
}

/**
 * Looks up an agent by phone for the AgentRow component (the listing
 * detail modal's agent reference, and the booking detail dialog's contact
 * reference) — creates a bare row if one doesn't exist yet, same
 * lazy-upsert reasoning as ensureAgentsBackfilled above, so clicking one
 * of those rows always opens something instead of erroring just because
 * the Agents tab hasn't been visited since this phone first showed up.
 */
export async function getOrCreateAgentByPhone(
  phone: string,
  name: string | null
): Promise<AgentWithListings | null> {
  const trimmedPhone = phone.trim();
  if (!trimmedPhone) return null;

  let [agent] = await db.select().from(agents).where(eq(agents.phone, trimmedPhone));
  if (!agent) {
    [agent] = await db
      .insert(agents)
      .values({ phone: trimmedPhone, name: name?.trim() || null })
      .returning();
  }
  if (!agent) return null;

  const agentListings = await db.select().from(listings).where(eq(listings.agentPhone, trimmedPhone));

  return { agent, listings: agentListings };
}

/**
 * The full "cold, never contacted" bucket — deliberately NOT loaded by
 * default (see AgentsContent in page.tsx, which fetches only the most
 * recent COLD_PAGE_SIZE of these). Fetched on demand when "View all N
 * agents" is clicked, so a page load doesn't have to ship every one of the
 * thousands of untouched leads just to render 15 of them.
 */
export async function getAllColdAgents(): Promise<Agent[]> {
  return db
    .select()
    .from(agents)
    .where(and(eq(agents.relationshipStatus, "cold"), isNull(agents.declinedAt)))
    .orderBy(desc(agents.createdAt));
}

/**
 * Powers the Agents page's search box — a live DB query rather than
 * filtering an in-memory list, since (unlike searchAgentsByName's
 * Compose-autocomplete use) the page no longer has every agent loaded
 * client-side to filter in the first place. Same substring semantics as
 * the old client-side matchesSearch: name/email/phone, plus a
 * digits-only phone comparison so "5035551234" still matches a
 * "503-555-1234" row.
 */
export async function searchAllAgents(query: string): Promise<Agent[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const digits = trimmed.replace(/\D/g, "");
  const like = `%${trimmed}%`;
  const conditions = [ilike(agents.name, like), ilike(agents.email, like), ilike(agents.phone, like)];
  if (digits.length >= 3) conditions.push(ilike(agents.phone, `%${digits}%`));

  return db
    .select()
    .from(agents)
    .where(or(...conditions))
    .orderBy(desc(agents.createdAt))
    .limit(100);
}

/** Total distinct listings sourced from each agent phone — shown on the agent card. */
export async function listingCountsByPhone(): Promise<Record<string, number>> {
  const rows = await db
    .select({ phone: listings.agentPhone, count: sql<number>`count(*)::int` })
    .from(listings)
    .where(isNotNull(listings.agentPhone))
    .groupBy(listings.agentPhone);

  const result: Record<string, number> = {};
  for (const r of rows) {
    if (r.phone) result[r.phone] = r.count;
  }
  return result;
}

export interface AgentSendHistoryItem {
  id: string;
  presetName: string;
  channel: MessageChannel;
  type: PresetType;
  sentAt: Date;
  respondedAt: Date | null;
  result: MessageResult;
}

/** Every SMS/email logged against this agent (any listing, or none — see the cold-email Compose flow), newest first. */
export async function getAgentSendHistory(agentId: string): Promise<AgentSendHistoryItem[]> {
  return db
    .select({
      id: messageSends.id,
      presetName: messagePresets.name,
      channel: messageSends.channel,
      type: messageSends.type,
      sentAt: messageSends.sentAt,
      respondedAt: messageSends.respondedAt,
      result: messageSends.result,
    })
    .from(messageSends)
    .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
    .where(eq(messageSends.agentId, agentId))
    .orderBy(desc(messageSends.sentAt));
}

/**
 * Resolves the agent's profile URL — Zillow preferred, falling back to
 * realtor.com if Zillow doesn't have a matching profile. Same "search their
 * name" a person would type by hand, done server-side via Tavily so the
 * button can jump straight to the profile. Cached on the agent row
 * (realtorProfileUrl — named for when this only searched realtor.com, now
 * holds whichever source actually matched) once found, so a repeat click
 * never re-spends a Tavily credit or re-pays the lookup latency. Returns
 * null on any failure so the button can fall back to a plain Google search
 * link — a miss is deliberately left uncached so a later retry can still
 * succeed.
 */
export async function findAgentProfileUrl(agent: { id: string; name: string | null }): Promise<string | null> {
  const [row] = await db.select({ url: agents.realtorProfileUrl }).from(agents).where(eq(agents.id, agent.id));
  if (row?.url) return row.url;

  if (!agent.name) return null;
  const resolved =
    (await findFirstNameMatchResultUrl(agent.name, "zillow.com")) ??
    (await findFirstResultUrl(agent.name, "realtor.com"));

  if (resolved) {
    await db.update(agents).set({ realtorProfileUrl: resolved }).where(eq(agents.id, agent.id));
  }

  return resolved;
}
