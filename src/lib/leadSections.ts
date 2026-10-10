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

import { and, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db";
import { agentInteractions, agents, listings, messageSends, type Listing } from "@/db/schema";

export type LeadSection = "photo" | "video" | "backup" | "texted" | "unlikely";

/** "Listed or relisted in the last two weeks, or took a price cut recently." */
export const LEAD_FRESH_DAYS = 14;

/** Under this, a shoot isn't worth the drive. */
export const LEAD_MIN_PRICE = 250_000;
/** Over this, a listing wants video rather than a backup-photographer text. */
export const LEAD_VIDEO_PRICE = 750_000;
/**
 * A lead whose agent Lukas texted or called within this many days goes to
 * unlikely, whatever the section — a second text inside a week to someone who
 * hasn't answered the first reads as spam. After a week it comes back, and he
 * checks in again. Emails don't count: nearly everyone got the cold email run.
 */
export const LEAD_RECENT_CONTACT_DAYS = 7;
/** A listing scoring this or better already has photos good enough. */
export const LEAD_GOOD_PHOTO_SCORE = 6;

export const LEAD_SECTION_LABELS: Record<LeadSection, string> = {
  photo: "Photo opportunities",
  video: "Video opportunities",
  backup: "Backup opportunities",
  texted: "Texted before",
  unlikely: "Unlikely matches",
};

/** One line of guidance handed to the AI so its pitch matches the section. */
export const LEAD_SECTION_BRIEFS: Record<LeadSection, string> = {
  photo: "Bad or missing photos — the opening is to offer to shoot the listing properly.",
  video: "High-end listing with good existing photos — the opening is to offer video, not basic photos.",
  backup: "Ordinary listing with photos he's already happy with — do NOT pitch him on photo quality. He's a backup option, and has been: he's busy, his usual person is booked, or he needs a quick turnaround.",
  texted: "He texted or called this agent before, about another listing, and never heard back. Do NOT introduce him again or reuse a first-contact opener — this is a short second touch that picks up from the earlier text, with this new listing as the reason.",
  unlikely: "Do not text this agent about this listing.",
};

/** The listing facts a section decision depends on. */
export interface LeadSectionInput {
  price: number | null;
  score: number | null;
  agentId?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  brokerName?: string | null;
  /** The attached agent's relationship status, when one is resolved. */
  relationshipStatus?: string | null;
  listedAt?: Date | null;
  priceCutAt?: Date | null;
  resurfacedAt?: Date | null;
  /** When Lukas last texted or called the attached agent, if ever (see lastTextByAgent). */
  lastContactedAt?: Date | null;
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

/**
 * Brokerages that are really home builders (Lennar, D.R. Horton, Sekisui
 * House…). Their listings are the same plan over and over, often with
 * rendered photos, and their sales reps don't hire photographers. Matched on
 * the listing's brokerage, which is how builders list on Zillow. Checked
 * against every brokerage on file: "Mountain West" is left out on purpose
 * (Coldwell Banker Mountain West is a normal brokerage).
 */
const BUILDER_BROKER =
  /\b(lennar|d\.?\s?r\.?\s?horton|sekisui|pulte|del webb|toll brothers|kb home|weekley|taylor morrison|richmond american|meritage|century communities|hayden homes|pahlisch|holt homes|stone ?bridge homes|legend homes|adair homes|woodbridge homes|kda homes|pacific lifestyle homes|custom homes|new home (co|company|star)|homes,? inc|homes llc|sales corp|home ?builders?|builders?|construction|communities)\b/i;

export function isBuilderListing(brokerName: string | null | undefined): boolean {
  return !!brokerName && BUILDER_BROKER.test(brokerName);
}

/**
 * Brokerages that arrange listing media themselves. Redfin books and pays for
 * its agents' photos centrally, so the agent has no say in who shoots and
 * there's nothing to pitch them (Lukas, 2026-10-09).
 */
const IN_HOUSE_MEDIA_BROKER = /\bredfin\b/i;

export function hasInHouseMedia(brokerName: string | null | undefined): boolean {
  return !!brokerName && IN_HOUSE_MEDIA_BROKER.test(brokerName);
}

/** Texted or called inside the last LEAD_RECENT_CONTACT_DAYS. */
export function isRecentlyTexted(lastTextedAt: Date | null | undefined): boolean {
  const age = daysSince(lastTextedAt);
  return age != null && age < LEAD_RECENT_CONTACT_DAYS;
}

/** Under the floor, unreachable, a builder, a brokerage that handles its own media, or the agent already turned us down. */
export function isLeadUnlikely(listing: LeadSectionInput): boolean {
  if (listing.price != null && listing.price < LEAD_MIN_PRICE) return true;
  if (hasNoAgent(listing)) return true;
  if (isBuilderListing(listing.brokerName)) return true;
  if (hasInHouseMedia(listing.brokerName)) return true;
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
 *
 * The photo boundary is 6: a score of 6 or better counts as photos being fine
 * and belongs in backup/video, and only 5 or below (or unscored) is a photo
 * opportunity.
 *
 * "Texted before" sits between the two contact rules: inside a week the lead
 * waits in unlikely, and after that a still-cold agent's listings collect in
 * texted rather than going back among the people who've never heard from him. A matching floor of 6 is what the preset targeting uses, so the
 * two can never disagree about where the line sits.
 */
export function leadSection(listing: LeadSectionInput): LeadSection {
  if (isLeadUnlikely(listing)) return "unlikely";
  const price = listing.price;
  const score = listing.score;
  const fresh = isLeadFresh(listing);
  const goodPhotos = score != null && score >= LEAD_GOOD_PHOTO_SCORE;

  if (isRecentlyTexted(listing.lastContactedAt)) return "unlikely";
  // A stranger he has already texted can't get an opener again — every template
  // starts "Hey there, I'm Lukas" and they've had that one. They get their own
  // section whatever the listing looks like. People who answered are warm or
  // better by now and keep the section the listing earns.
  if (listing.lastContactedAt && (listing.relationshipStatus ?? "cold") === "cold") return "texted";
  if (!goodPhotos && fresh) return "photo";
  if (price != null && price > LEAD_VIDEO_PRICE && goodPhotos && fresh) return "video";
  return "backup";
}

/** Convenience for a full listings row plus its resolved agent. */
export function leadSectionForListing(
  listing: Listing,
  relationshipStatus?: string | null
): LeadSection {
  return leadSection({ ...listing, relationshipStatus });
}

/** Display order on the Leads page, most actionable first. */
export const LEAD_SECTION_ORDER: LeadSection[] = ["photo", "video", "backup", "texted", "unlikely"];

/**
 * Recomputes and stores listings.leadSection for the given ids, and returns
 * how many actually moved. Called wherever the inputs that decide a section
 * change — a price cut, a photo score landing, an agent being linked or
 * declined — because a stored column is only useful if it's kept honest, and a
 * section that silently went stale would mis-route every message
 * recommendation built on it.
 *
 * Bulk by design: the whole point is to avoid one write per listing on the
 * leads page, so callers hand over every id they just touched. Returns every
 * listing's settled section, so the Leads page can bucket straight from it.
 */
export async function refreshLeadSections(ids: string[]): Promise<Map<string, LeadSection>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: listings.id,
      leadSection: listings.leadSection,
      price: listings.price,
      score: listings.score,
      agentId: listings.agentId,
      agentName: listings.agentName,
      agentPhone: listings.agentPhone,
      brokerName: listings.brokerName,
      listedAt: listings.listedAt,
      priceCutAt: listings.priceCutAt,
      resurfacedAt: listings.resurfacedAt,
      relationshipStatus: agents.relationshipStatus,
    })
    .from(listings)
    .leftJoin(agents, eq(listings.agentId, agents.id))
    .where(inArray(listings.id, ids));

  const lastContact = await lastTextByAgent(
    rows.map((r) => r.agentId).filter((id): id is string => id != null)
  );

  // leadSection() rather than leadSectionForListing(): this is a projected row,
  // not a full Listing, and the section rules only ever read these fields.
  const decided = rows.map((r) => ({
    id: r.id,
    section: leadSection({
      ...r,
      relationshipStatus: r.relationshipStatus,
      lastContactedAt: r.agentId ? lastContact.get(r.agentId) ?? null : null,
    }),
  }));
  const changed = decided.filter((r) => {
    const stored = rows.find((x) => x.id === r.id)?.leadSection ?? null;
    return stored !== r.section;
  });
  // Sequential rather than a batched transaction: the counts involved are tens
  // per sync, and this keeps the write obviously correct.
  for (const row of changed) {
    await db.update(listings).set({ leadSection: row.section }).where(eq(listings.id, row.id));
  }
  return new Map(decided.map((r) => [r.id, r.section]));
}

/**
 * When Lukas last texted or called each agent: SMS sends plus outbound text and
 * call interactions (including ones still pending confirmation, since the text
 * most likely went). Emails and their replies don't count — see
 * LEAD_RECENT_CONTACT_DAYS.
 */
export async function lastTextByAgent(agentIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  const ids = [...new Set(agentIds)];
  if (ids.length === 0) return out;
  const [sends, interactions] = await Promise.all([
    db
      .select({ agentId: messageSends.agentId, at: max(messageSends.sentAt) })
      .from(messageSends)
      .where(and(inArray(messageSends.agentId, ids), eq(messageSends.channel, "sms")))
      .groupBy(messageSends.agentId),
    db
      .select({ agentId: agentInteractions.agentId, at: max(agentInteractions.occurredAt) })
      .from(agentInteractions)
      .where(
        and(
          inArray(agentInteractions.agentId, ids),
          eq(agentInteractions.direction, "outbound"),
          inArray(agentInteractions.channel, ["text", "call"])
        )
      )
      .groupBy(agentInteractions.agentId),
  ]);
  for (const row of [...sends, ...interactions]) {
    if (!row.agentId || !row.at) continue;
    const at = new Date(row.at);
    const current = out.get(row.agentId);
    if (!current || at > current) out.set(row.agentId, at);
  }
  return out;
}
