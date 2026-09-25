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
import { eq, isNotNull, isNull, sql, desc, and, ne, or, ilike, asc, lt, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { findFirstResultUrl, findFirstNameMatchResultUrl } from "@/lib/tavily";
import { normalizePhone, normalizeEmail, normalizeName, EMAIL_RE, hasValidPhoneDigitCount } from "@/lib/normalize";
import { resolveAgentId } from "@/lib/agentIdentity";

/**
 * Idempotent self-heal: gives every listing that has agent details but no
 * agentId a resolved agent record, creating one only when nobody on file
 * matches. Safe on every page load — existing rows are never overwritten.
 *
 * Driven off `listings.agentId IS NULL` rather than off missing phones. It used
 * to LEFT JOIN agents on agentPhone and insert a row for every phone with no
 * match, which meant a realtor already on file from a cold-email import (email,
 * no phone) got a second, phone-only record every time one of their listings
 * arrived — the split-identity bug. resolveAgentId matches by name as well as
 * phone and fills in the missing field instead.
 *
 * Normally a no-op, since the sync/import path links listings as they arrive;
 * this only catches rows that predate agentId or whose agent couldn't be
 * resolved at the time.
 */
export async function ensureAgentsBackfilled() {
  const unlinked = await db
    .select({
      id: listings.id,
      agentPhone: listings.agentPhone,
      agentName: listings.agentName,
    })
    .from(listings)
    .where(and(isNull(listings.agentId), or(isNotNull(listings.agentPhone), isNotNull(listings.agentName))));

  if (unlinked.length === 0) return;

  for (const row of unlinked) {
    // Links the listing to its agent and nothing else. This used to also stamp
    // relationshipStatus "declined" off a declined listing, which is the same
    // per-listing-no-means-person-said-no conflation removed from
    // updateListingStatus — and worse here, since a backfill pass would re-apply
    // it to agents whose status had since been corrected by hand.
    const agentId = await resolveAgentId(row.agentPhone, row.agentName);
    if (agentId) {
      await db.update(listings).set({ agentId }).where(eq(listings.id, row.id));
    }
  }
  // No revalidatePath here: this is called during the Agents page's own render,
  // where Next forbids it — and it would be pointless anyway, since the render
  // reading these rows is the one happening right now.
}

export async function updateAgentRelationshipStatus(id: string, status: AgentRelationshipStatus) {
  await db.update(agents).set({ relationshipStatus: status }).where(eq(agents.id, id));
  revalidatePath("/agents");
}

/** Clears declined status — moves an agent back to cold. */
export async function reconnectAgent(id: string) {
  await db.update(agents).set({ relationshipStatus: "cold" }).where(eq(agents.id, id));
  revalidatePath("/agents");
}

export async function updateAgentNotes(id: string, notes: string) {
  await db.update(agents).set({ notes: notes.trim() || null }).where(eq(agents.id, id));
  revalidatePath("/agents");
}

interface ContactInfoResult {
  error?: string;
  phone?: string | null;
  email?: string | null;
}

/** Shared by importAgent and updateAgentContactInfo — at least one of phone/email required, both format-checked. */
function parseContactInfo(phoneInput: string, emailInput: string): ContactInfoResult {
  const trimmedPhone = phoneInput.trim();
  const trimmedEmail = emailInput.trim();
  if (!trimmedPhone && !trimmedEmail) return { error: "Enter a phone number or an email" };

  let phone: string | null = null;
  if (trimmedPhone) {
    phone = normalizePhone(trimmedPhone);
    if (!hasValidPhoneDigitCount(phone)) return { error: "Enter a valid phone number" };
  }
  let email: string | null = null;
  if (trimmedEmail) {
    const normalized = normalizeEmail(trimmedEmail);
    if (!EMAIL_RE.test(normalized)) return { error: "Enter a valid email address" };
    email = normalized;
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
    name: input.name.trim() ? normalizeName(input.name) : null,
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
    .set({ name: input.name.trim() ? normalizeName(input.name) : null, phone, email, relationshipStatus: input.relationshipStatus })
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
  input: {
    avgListingsPerYear: number | null;
    avgListingPrice: number | null;
    avgDaysBetweenListings: number | null;
  }
) {
  await db
    .update(agents)
    .set({
      avgListingsPerYear: input.avgListingsPerYear,
      avgListingPrice: input.avgListingPrice,
      avgDaysBetweenListings: input.avgDaysBetweenListings,
    })
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
  if (!phone || !hasValidPhoneDigitCount(phone)) return { error: "Enter a valid phone number" };

  const trimmedEmail = normalizeEmail(input.email);
  if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) return { error: "Enter a valid email address" };
  const typedEmail = trimmedEmail || null;
  const typedName = input.name.trim() ? normalizeName(input.name) : null;
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

/**
 * Looks up an agent by phone for the AgentRow component (the listing
 * detail modal's agent reference, and the booking detail dialog's contact
 * reference) — creates a bare row if one doesn't exist yet, same
 * lazy-upsert reasoning as ensureAgentsBackfilled above, so clicking one
 * of those rows always opens something instead of erroring just because
 * the Agents tab hasn't been visited since this phone first showed up.
 */
/**
 * Read-only relationship lookup for AgentRow (the listing detail modal's
 * agent reference) — so the row can show "Warm"/"Interested"/etc. at a
 * glance without creating anything. Unlike getOrCreateAgentByPhone below,
 * this deliberately does NOT upsert: just opening a listing's detail modal
 * shouldn't mint an agent row for a phone we've never seen.
 */
export async function getAgentRelationshipByPhone(
  phone: string
): Promise<{ relationshipStatus: AgentRelationshipStatus } | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  const [agent] = await db
    .select({ relationshipStatus: agents.relationshipStatus })
    .from(agents)
    .where(eq(agents.phone, normalizedPhone));
  return agent ?? null;
}

export async function getOrCreateAgentByPhone(
  phone: string,
  name: string | null
): Promise<Agent | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  let [agent] = await db.select().from(agents).where(eq(agents.phone, normalizedPhone));
  if (!agent) {
    [agent] = await db
      .insert(agents)
      .values({ phone: normalizedPhone, name: name?.trim() ? normalizeName(name) : null })
      .returning();
  }
  if (!agent) return null;

  return agent;
}

/**
 * The "Follow up" queue for the top of the Agents tab.
 *
 * Eligibility: a warm or interested relationship, and no real contact in
 * the last 28 days (lastContactedAt older than 28 days — or never), and
 * not dismissed by Lukas in the last 28 days (followUpDismissedAt — the
 * "snooze" from the Dismiss button, which is deliberately tracked
 * separately from the real contact facts so dismissing doesn't lie about
 * when they were actually contacted).
 *
 * Order: interested first, then warm; within each, longest-untouched
 * first (the still-contactable-but-pretty-old reasoning that makes an
 * overstretched warm lead worth nudging the most). Never-contacted sorts
 * ahead of the merely long-overdue.
 */
export async function getFollowUpAgents(): Promise<Agent[]> {
  return db
    .select()
    .from(agents)
    .where(
      and(
        inArray(agents.relationshipStatus, ["interested", "warm"]),
        or(
          isNull(agents.lastContactedAt),
          lt(agents.lastContactedAt, sql`now() - interval '28 days'`)
        ),
        or(
          isNull(agents.followUpDismissedAt),
          lt(agents.followUpDismissedAt, sql`now() - interval '28 days'`)
        )
      )
    )
    .orderBy(
      sql`case ${agents.relationshipStatus} when 'interested' then 0 else 1 end`,
      desc(sql`${agents.lastContactedAt} is null`),
      asc(agents.lastContactedAt)
    );
}

/**
 * "Snooze" an agent out of the Follow up queue for the next 28 days — sets
 * followUpDismissedAt, which stays separate from lastContactedAt so the
 * "Last contacted" date on the card keeps telling the truth about when
 * they were actually reached. Re-appears once this timestamp is itself
 * over 28 days old and the other criteria still hold.
 */
export async function dismissFollowUpAgent(id: string) {
  await db.update(agents).set({ followUpDismissedAt: new Date() }).where(eq(agents.id, id));
  revalidatePath("/agents");
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
export async function listingCountsByAgent(): Promise<Record<string, number>> {
  const rows = await db
    .select({ agentId: listings.agentId, count: sql<number>`count(*)::int` })
    .from(listings)
    .where(isNotNull(listings.agentId))
    .groupBy(listings.agentId);

  const result: Record<string, number> = {};
  for (const r of rows) {
    if (r.agentId) result[r.agentId] = r.count;
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

/**
 * Full listing rows for one agent, fetched when their detail dialog opens.
 *
 * The Agents page used to load every linked listing up front so each card
 * could hand a full array down to its dialog. That pulled listings.photos —
 * an array of image URLs per listing — for hundreds of listings on every page
 * load, to render a list that shows only an address and a price, and only for
 * the one agent whose dialog is actually open. Same shape of unbounded fetch
 * that ran this app's database transfer quota out once already.
 */
export async function getAgentListings(agentId: string): Promise<Listing[]> {
  return db
    .select()
    .from(listings)
    .where(eq(listings.agentId, agentId))
    .orderBy(desc(sql`coalesce(${listings.listedAt}, ${listings.foundAt})`));
}

/**
 * Just the two dates every agent card needs for its "~Nd between listings"
 * stat (see averageDaysBetweenListings), keyed by agent. Deliberately not the
 * full rows — see getAgentListings above.
 */
export async function listingDatesByAgent(): Promise<Record<string, { listedAt: Date | null; foundAt: Date }[]>> {
  const rows = await db
    .select({ agentId: listings.agentId, listedAt: listings.listedAt, foundAt: listings.foundAt })
    .from(listings)
    .where(isNotNull(listings.agentId));

  const byAgent: Record<string, { listedAt: Date | null; foundAt: Date }[]> = {};
  for (const r of rows) {
    if (!r.agentId) continue;
    (byAgent[r.agentId] ??= []).push({ listedAt: r.listedAt, foundAt: r.foundAt });
  }
  return byAgent;
}
