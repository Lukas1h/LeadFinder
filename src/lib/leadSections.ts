// How a new listing is sorted into one of the Leads page's four sections.
//
// Replaces the single photo/price "unlikely" test that used to decide
// everything. That rule demoted anything scoring over 7 under $650k, which on
// real data was 86% of the list — Gemini scores 88 of 163 listings at exactly
// 8, so "score > 7" separated almost nothing. The sections below are the four
// things worth actually texting an agent about, and they partition the list
// exhaustively so no lead silently disappears.
//
// Shared by the Leads page and the AI draft prompt (src/lib/draftMessage.ts),
// so the copy a draft is written for can't disagree with the section the
// listing was found in.

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agents, listings, type Listing } from "@/db/schema";

export type LeadSection = "photo" | "video" | "backup" | "unlikely";

/** "Listed or relisted in the last two weeks, or took a price cut recently." */
export const LEAD_FRESH_DAYS = 14;

/** Under this, a shoot isn't worth the drive. */
export const LEAD_MIN_PRICE = 250_000;
/** Over this, a listing wants video rather than a backup-photographer text. */
export const LEAD_VIDEO_PRICE = 750_000;

export const LEAD_SECTION_LABELS: Record<LeadSection, string> = {
  photo: "Photo opportunities",
  video: "Video opportunities",
  backup: "Backup opportunities",
  unlikely: "Unlikely matches",
};

/** One line of guidance handed to the AI so its pitch matches the section. */
export const LEAD_SECTION_BRIEFS: Record<LeadSection, string> = {
  photo: "Bad or missing photos — the opening is to offer to shoot the listing properly.",
  video: "High-end listing with good existing photos — the opening is to offer video, not basic photos.",
  backup: "Ordinary listing with photos he's already happy with — do NOT pitch him on photo quality. He's a backup option, and has been: he's busy, his usual person is booked, or he needs a quick turnaround.",
  unlikely: "Do not text this agent about this listing.",
};

/** The listing facts a section decision depends on. */
export interface LeadSectionInput {
  price: number | null;
  score: number | null;
  agentId?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  /** The attached agent's relationship status, when one is resolved. */
  relationshipStatus?: string | null;
  listedAt?: Date | null;
  priceCutAt?: Date | null;
  resurfacedAt?: Date | null;
}

function daysSince(date: Date | null | undefined): number | null {
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / (24 * 60 * 60 * 1000)));
}

/**
 * Recently listed, relisted, or repriced. The price-cut arm matters because a
 * cut is exactly when a photographer's offer lands best, and those listings are
 * often weeks old.
 */
export function isLeadFresh(listing: LeadSectionInput): boolean {
  const now = new Date();
  const within = (d: Date | null | undefined) => {
    const age = daysSince(d);
    return age != null && age <= LEAD_FRESH_DAYS && new Date(d!).getTime() <= now.getTime();
  };
  return within(listing.listedAt) || within(listing.resurfacedAt) || within(listing.priceCutAt);
}

/** Nobody to contact: no linked row, and no name or phone on the listing itself. */
export function hasNoAgent(listing: LeadSectionInput): boolean {
  return (
    listing.agentId == null &&
    !(listing.agentName ?? "").trim() &&
    !(listing.agentPhone ?? "").trim()
  );
}

/** Under the floor, unreachable, or the agent already turned us down. */
export function isLeadUnlikely(listing: LeadSectionInput): boolean {
  if (listing.price != null && listing.price < LEAD_MIN_PRICE) return true;
  if (hasNoAgent(listing)) return true;
  return listing.relationshipStatus === "declined";
}

/**
 * The one place a lead is assigned to a section. Order is the whole design:
 * unlikely is checked first so nothing expensive-looking sneaks past it, and
 * video outranks photo so a $900k listing with a middling score is pitched as
 * video rather than as a rescue job.
 *
 * Unscored listings (score still null because photo scoring hasn't run) are
 * treated as weak photos, which puts them in the photo section — they're fresh
 * by definition if we only just found them, and a "good photos, no evidence"
 * assumption is the riskier one to make in a cold text.
 */
export function leadSection(listing: LeadSectionInput): LeadSection {
  if (isLeadUnlikely(listing)) return "unlikely";
  const price = listing.price;
  const score = listing.score;
  const fresh = isLeadFresh(listing);
  const goodPhotos = score != null && score > 6;

  if (price != null && price > LEAD_VIDEO_PRICE && goodPhotos && fresh) return "video";
  if (!goodPhotos && fresh) return "photo";
  return "backup";
}

/** Groups a set of listings into the four sections, each in the order given. */
export function partitionByLeadSection<T extends LeadSectionInput>(
  items: T[],
  statusFor: (item: T) => string | null | undefined
): Record<LeadSection, T[]> {
  const out: Record<LeadSection, T[]> = { photo: [], video: [], backup: [], unlikely: [] };
  for (const item of items) {
    out[leadSection({ ...item, relationshipStatus: statusFor(item) })].push(item);
  }
  return out;
}

/** Convenience for a full listings row plus its resolved agent. */
export function leadSectionForListing(
  listing: Listing,
  relationshipStatus?: string | null
): LeadSection {
  return leadSection({ ...listing, relationshipStatus });
}

/** Display order on the Leads page, most actionable first. */
export const LEAD_SECTION_ORDER: LeadSection[] = ["photo", "video", "backup", "unlikely"];

/**
 * Recomputes and stores listings.leadSection for the given ids, and returns
 * how many actually moved. Called wherever the inputs that decide a section
 * change — a price cut, a photo score landing, an agent being linked or
 * declined — because a stored column is only useful if it's kept honest, and a
 * section that silently went stale would mis-route every message
 * recommendation built on it.
 *
 * Bulk by design: the whole point is to avoid one write per listing on the
 * leads page, so callers hand over every id they just touched.
 */
export async function refreshLeadSections(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .select({
      id: listings.id,
      leadSection: listings.leadSection,
      price: listings.price,
      score: listings.score,
      agentId: listings.agentId,
      agentName: listings.agentName,
      agentPhone: listings.agentPhone,
      listedAt: listings.listedAt,
      priceCutAt: listings.priceCutAt,
      resurfacedAt: listings.resurfacedAt,
      relationshipStatus: agents.relationshipStatus,
    })
    .from(listings)
    .leftJoin(agents, eq(listings.agentId, agents.id))
    .where(inArray(listings.id, ids));

  // leadSection() rather than leadSectionForListing(): this is a projected row,
  // not a full Listing, and the section rules only ever read these fields.
  const decided = rows.map((r) => ({ id: r.id, section: leadSection({ ...r, relationshipStatus: r.relationshipStatus }) }));
  const changed = decided.filter((r) => {
    const stored = rows.find((x) => x.id === r.id)?.leadSection ?? null;
    return stored !== r.section;
  });
  if (changed.length === 0) return 0;

  // Sequential rather than a batched transaction: the counts involved are tens
  // per sync, and this keeps the write obviously correct.
  for (const row of changed) {
    await db.update(listings).set({ leadSection: row.section }).where(eq(listings.id, row.id));
  }
  return changed.length;
}
