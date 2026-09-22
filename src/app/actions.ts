"use server";

import { db } from "@/db";
import { listings, agents, messageSends, type LeadStatus, type AgentRelationshipStatus, type NewListing } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { runSync, insertAndEnrichListings, type SyncResult } from "@/lib/sync";
import { extractZpidFromUrl, fetchFullListing } from "@/lib/zillapi";
import { findFirstAddressResultUrl } from "@/lib/tavily";
import { resolveAgentId } from "@/lib/agentIdentity";

export async function touchAgentContact(
  listingId: string,
  agentPhone: string | null,
  agentName: string | null
): Promise<string | null> {
  const agentId = await resolveAgentId(agentPhone, agentName, {
    lastContactedAt: new Date(),
    lastContactedListingId: listingId,
  });
  // Contacting a listing is the point where its agent is definitively known, so
  // record the link rather than leaving later reads to re-derive it from the
  // phone string.
  if (agentId) {
    await db.update(listings).set({ agentId }).where(eq(listings.id, listingId));
  }
  return agentId;
}

/**
 * Marks the agent's Agent-tab record declined — sets their relationship status
 * to "declined" so they appear in the appropriate section on the Agents page.
 *
 * Only ever called for a listing moving to "declined" (the agent actually said
 * no), never for "passed" (Lukas decided not to shoot the property). Passing on
 * a property is a judgment about the property, not the person, and treating the
 * two the same is what previously flagged warm contacts as rejections.
 */
async function touchAgentDeclined(agentPhone: string | null, agentName: string | null) {
  await resolveAgentId(agentPhone, agentName, { relationshipStatus: "declined" });
}

/**
 * Bumps an agent's relationship status forward the moment one of their
 * listings hits a milestone — a reply or a booking — so the Agents tab
 * reflects real pipeline activity instead of drifting from whatever was
 * last set (or never set) by hand. Never downgrades, and a reply on an
 * agent already past "interested" (worked_once/regular) leaves it alone.
 */
export async function bumpAgentRelationshipOnMilestone(
  agentPhone: string | null,
  agentName: string | null,
  milestone: "replied" | "booked"
) {
  // resolveAgentId rather than a phone lookup: this was the last place still
  // finding an agent by phone alone, which meant a reply from someone who only
  // existed as an email-only contact created a duplicate phone-keyed row
  // instead of promoting the record that actually holds the relationship.
  const agentId = await resolveAgentId(agentPhone, agentName);
  if (!agentId) return;

  const [existing] = await db
    .select({ relationshipStatus: agents.relationshipStatus })
    .from(agents)
    .where(eq(agents.id, agentId));

  const current = existing?.relationshipStatus ?? "cold";
  let target: AgentRelationshipStatus | null = null;
  if (milestone === "replied") {
    if (current === "cold" || current === "warm") target = "interested";
  } else {
    if (current === "cold" || current === "warm" || current === "interested") target = "worked_once";
    else if (current === "worked_once") target = "regular";
  }
  if (!target) return;

  await db.update(agents).set({ relationshipStatus: target }).where(eq(agents.id, agentId));
}

/**
 * Attributes a pipeline status change back to whichever message preset
 * variant was most recently sent to this listing — the data point the
 * messaging page's stats are built from. respondedAt is only ever set once
 * (the first reply); result is always overwritable, so a later "declined"
 * after an earlier "replied" correctly updates the same row instead of
 * being silently dropped. A no-op if nothing was ever logged (e.g. a
 * listing marked declined without ever being texted).
 *
 * "passed" deliberately isn't handled: Lukas dropping a property tells us
 * nothing about how the message landed, so the send stays "pending" (unknown)
 * rather than being recorded as a rejection the agent never made. Writing
 * result="declined" off a pass is what made the messaging page's per-variant
 * decline numbers meaningless.
 */
export async function resolveSendOutcome(listingId: string, status: LeadStatus) {
  if (status !== "replied" && status !== "quoted" && status !== "booked" && status !== "declined") return;

  const [latest] = await db
    .select({ id: messageSends.id, respondedAt: messageSends.respondedAt })
    .from(messageSends)
    .where(eq(messageSends.listingId, listingId))
    .orderBy(desc(messageSends.sentAt))
    .limit(1);

  if (!latest) return;

  const patch: { respondedAt?: Date; result?: "quoted" | "booked" | "declined" } = {};
  if (status === "replied") {
    if (!latest.respondedAt) patch.respondedAt = new Date();
  } else {
    patch.result = status;
  }

  if (Object.keys(patch).length > 0) {
    await db.update(messageSends).set(patch).where(eq(messageSends.id, latest.id));
  }
}

export async function updateListingStatus(listingId: string, status: LeadStatus) {
  const now = new Date();
  const [lead] = await db
    .update(listings)
    .set({
      status,
      statusChangedAt: now,
      ...(status === "contacted" ? { contactedAt: now } : {}),
    })
    .where(eq(listings.id, listingId))
    .returning({ agentPhone: listings.agentPhone, agentName: listings.agentName });

  if (status === "contacted" && lead) {
    await touchAgentContact(listingId, lead.agentPhone, lead.agentName);
  }
  if (status === "declined" && lead) {
    await touchAgentDeclined(lead.agentPhone, lead.agentName);
  }
  if ((status === "replied" || status === "booked") && lead) {
    await bumpAgentRelationshipOnMilestone(lead.agentPhone, lead.agentName, status);
  }

  await resolveSendOutcome(listingId, status);

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/messaging");
  revalidatePath("/agents");
}

/**
 * Bulk triage — "Not interested" on unlikely matches. These are Lukas's own
 * calls about properties he doesn't want to shoot, so they mark the listings
 * "passed" and deliberately touch neither the agents nor the send outcomes:
 * dropping someone's listing from the queue is not that person rejecting him,
 * and this bulk button firing touchAgentDeclined is exactly what stamped
 * declinedAt across 285 agents who had never turned him down.
 */
export async function markListingsPassed(listingIds: string[]) {
  if (listingIds.length === 0) return;
  await db
    .update(listings)
    .set({
      status: "passed",
      statusChangedAt: new Date(),
    })
    .where(inArray(listings.id, listingIds));

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/messaging");
  revalidatePath("/agents");
}

/** Free-text note on a listing — edited from the listing detail modal. */
export async function updateListingNotes(listingId: string, notes: string) {
  await db
    .update(listings)
    .set({ notes: notes.trim() || null })
    .where(eq(listings.id, listingId));

  revalidatePath("/");
  revalidatePath("/pipeline");
}

/**
 * Manual "come back to this on a specific date" reminder, edited from the
 * listing detail modal — independent of the automatic contactedAt-driven
 * follow-up flagging (see getFollowUpAfterDays in src/lib/settings.ts),
 * which only fires after a message has gone unanswered. This is for cases
 * like "the agent said check back Thursday."
 */
export async function updateListingFollowUp(
  listingId: string,
  followUpAt: Date | null,
  followUpNote: string | null
) {
  await db
    .update(listings)
    .set({ followUpAt, followUpNote: followUpNote?.trim() || null })
    .where(eq(listings.id, listingId));

  revalidatePath("/");
  revalidatePath("/pipeline");
}

/**
 * Manual "Refresh" button on the Leads page — same Zillapi/OpenAI cost as
 * a cron run (1 credit per listing *returned*, even ones we already have
 * and skip inserting), just triggered on demand instead of waiting for
 * tomorrow's scheduled sync. The client shows its own confirmation before
 * calling this.
 */
export async function triggerManualSync(): Promise<SyncResult> {
  const result = await runSync();
  revalidatePath("/");
  revalidatePath("/pipeline");
  return result;
}

export interface ImportListingResult {
  error?: string;
  inserted?: boolean;
}

/**
 * Imports a single listing from a Zillow URL — the "Import" button's text
 * box on the Leads page, and the iOS share-sheet shortcut (see
 * src/app/api/import-listing/route.ts, which runs this in the background
 * via after() rather than waiting on it), both funnel into this. One
 * Zillapi credit (fetchFullListing), same as a single email-alert import.
 */
export async function importListingFromUrl(url: string): Promise<ImportListingResult> {
  const zpid = extractZpidFromUrl(url);
  if (!zpid) {
    return { error: "That doesn't look like a Zillow listing URL." };
  }

  const [existing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.zpid, zpid));
  if (existing) {
    return { error: "That listing is already in your leads." };
  }

  const full = await fetchFullListing(zpid);
  if (!full) {
    return { error: "Couldn't fetch that listing from Zillow — try again in a bit." };
  }

  const inserted = await insertAndEnrichListings(
    [{ ...full, sourceLabel: "Manual import", status: "saved" }],
    { notificationUrl: "/pipeline" }
  );

  revalidatePath("/", "layout");

  return { inserted: inserted > 0 };
}

export interface ImportListingsResult {
  imported: number;
  skipped: number;
  failed: number;
}

/**
 * Batch version of importListingFromUrl for the Leads page's "Import"
 * text box — one or many pasted Zillow URLs at once. Listings already in
 * the table are silently skipped (not counted as failures) rather than
 * spending a fetchFullListing credit and an error message on each one.
 */
export async function importListingsFromUrls(urls: string[]): Promise<ImportListingsResult> {
  const zpids = new Set<string>();
  let failed = 0;
  for (const url of urls) {
    const zpid = extractZpidFromUrl(url.trim());
    if (zpid) zpids.add(zpid);
    else if (url.trim()) failed++;
  }

  if (zpids.size === 0) {
    return { imported: 0, skipped: 0, failed };
  }

  const existing = await db
    .select({ zpid: listings.zpid })
    .from(listings)
    .where(inArray(listings.zpid, [...zpids]));
  const existingZpids = new Set(existing.map((row) => row.zpid));

  const newZpids = [...zpids].filter((zpid) => !existingZpids.has(zpid));
  const skipped = zpids.size - newZpids.length;

  const fetched = await Promise.all(newZpids.map((zpid) => fetchFullListing(zpid)));
  const candidates: NewListing[] = fetched
    .filter((full) => full !== null)
    .map((full) => ({ ...full, sourceLabel: "Manual import", status: "saved" as const }));
  failed += newZpids.length - candidates.length;

  const inserted = await insertAndEnrichListings(candidates, { notificationUrl: "/pipeline" });

  revalidatePath("/", "layout");

  return { imported: inserted, skipped, failed };
}

/**
 * Resolves a listing's page on another source site (Realtor.com, Redfin) via
 * Tavily — the same "search the address, open the first result" a person
 * would do by hand. Returns null on any failure so the button can fall back
 * to a plain search link.
 */
const LISTING_URL_FIELD = {
  "realtor.com": "realtorUrl",
  "redfin.com": "redfinUrl",
} as const satisfies Record<string, keyof NewListing>;

export async function findListingSourceUrl(
  domain: string,
  lead: {
    id: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zipcode: string | null;
  }
): Promise<string | null> {
  const field = LISTING_URL_FIELD[domain as keyof typeof LISTING_URL_FIELD];

  if (field) {
    const [row] = await db.select({ url: listings[field] }).from(listings).where(eq(listings.id, lead.id));
    if (row?.url) return row.url;
  }

  if (!lead.address) return null;
  const query = [lead.address, lead.city, lead.state, lead.zipcode].filter(Boolean).join(" ");
  const resolved = await findFirstAddressResultUrl(query, domain, lead.address);

  if (resolved && field) {
    await db.update(listings).set({ [field]: resolved }).where(eq(listings.id, lead.id));
  }

  return resolved;
}
