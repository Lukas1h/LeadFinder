"use server";

import { db } from "@/db";
import { listings, agents, messageSends, type LeadStatus, type AgentRelationshipStatus, type NewListing } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { runSync, insertAndEnrichListings, type SyncResult } from "@/lib/sync";
import { extractZpidFromUrl, fetchFullListing } from "@/lib/zillapi";

export async function touchAgentContact(
  listingId: string,
  agentPhone: string | null,
  agentName: string | null
) {
  if (!agentPhone) return;
  await db
    .insert(agents)
    .values({
      phone: agentPhone,
      name: agentName,
      lastContactedAt: new Date(),
      lastContactedListingId: listingId,
    })
    .onConflictDoUpdate({
      target: agents.phone,
      set: {
        name: agentName,
        lastContactedAt: new Date(),
        lastContactedListingId: listingId,
      },
    });
}

/**
 * Marks the agent's Agent-tab record declined the moment a listing of
 * theirs is — this is what starts the 30-day resurface clock on the
 * Agents page, so it needs to fire live rather than only at backfill time.
 * Upserts (rather than requiring touchAgentContact to have run first)
 * since a lead can be declined straight from "new"/"saved" without ever
 * having been texted.
 */
async function touchAgentDeclined(agentPhone: string | null, agentName: string | null) {
  if (!agentPhone) return;
  const now = new Date();
  await db
    .insert(agents)
    .values({ phone: agentPhone, name: agentName, declinedAt: now })
    .onConflictDoUpdate({
      target: agents.phone,
      set: { declinedAt: now }, // don't touch name here — a decline shouldn't clobber a known name
    });
}

/**
 * Bumps an agent's relationship status forward the moment one of their
 * listings hits a milestone — a reply or a booking — so the Agents tab
 * reflects real pipeline activity instead of drifting from whatever was
 * last set (or never set) by hand. Never downgrades, and a reply on an
 * agent already past "interested" (worked_once/regular) leaves it alone.
 */
async function bumpAgentRelationshipOnMilestone(
  agentPhone: string | null,
  agentName: string | null,
  milestone: "replied" | "booked"
) {
  if (!agentPhone) return;

  const [existing] = await db
    .select({ id: agents.id, relationshipStatus: agents.relationshipStatus })
    .from(agents)
    .where(eq(agents.phone, agentPhone));

  const current = existing?.relationshipStatus ?? "cold";
  let target: AgentRelationshipStatus | null = null;
  if (milestone === "replied") {
    if (current === "cold" || current === "warm") target = "interested";
  } else {
    if (current === "cold" || current === "warm" || current === "interested") target = "worked_once";
    else if (current === "worked_once") target = "regular";
  }
  if (!target) return;

  if (existing) {
    await db.update(agents).set({ relationshipStatus: target }).where(eq(agents.id, existing.id));
  } else {
    await db.insert(agents).values({ phone: agentPhone, name: agentName, relationshipStatus: target });
  }
}

/**
 * Attributes a pipeline status change back to whichever message preset
 * variant was most recently sent to this listing — the data point the
 * presets page's stats are built from. respondedAt is only ever set once
 * (the first reply); result is always overwritable, so a later "declined"
 * after an earlier "replied" correctly updates the same row instead of
 * being silently dropped. A no-op if nothing was ever logged (e.g. a
 * listing marked declined without ever being texted).
 */
async function resolveSendOutcome(listingId: string, status: LeadStatus) {
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

export async function updateListingStatus(
  listingId: string,
  status: LeadStatus,
  bookingValue?: number | null
) {
  const now = new Date();
  const [lead] = await db
    .update(listings)
    .set({
      status,
      statusChangedAt: now,
      ...(status === "contacted" ? { contactedAt: now } : {}),
      ...(status === "booked" && bookingValue != null ? { bookingValue } : {}),
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
  revalidatePath("/presets");
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
 * Imports a single listing from a Zillow URL — the "Import" button's
 * clipboard flow on the Leads page, and the iOS share-sheet shortcut (see
 * src/app/api/import-listing/route.ts), both funnel into this. One Zillapi
 * credit (fetchFullListing), same as a single email-alert import.
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

  const inserted = await insertAndEnrichListings([
    { ...full, sourceLabel: "Manual import", status: "saved" },
  ]);

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/agents");

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

  const inserted = await insertAndEnrichListings(candidates);

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/agents");

  return { imported: inserted, skipped, failed };
}
