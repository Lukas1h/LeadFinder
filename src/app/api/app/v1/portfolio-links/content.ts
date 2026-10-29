import type { PortfolioContent, PortfolioListing } from "@/db/schema";
import { AGENT_PAGE_PHOTOS, AGENT_PAGE_VIDEOS } from "@/lib/agentPage";
import { BadBody } from "../helpers";

/**
 * Reads the builder's `content` from a request body into the PortfolioContent
 * the page renders, rejecting anything the page couldn't (an unknown video or
 * lead photo, a listing with no job id). Strings are trimmed; blank text
 * fields become null, as the web builder saves them.
 */

const text = (v: unknown, field: string): string | null => {
  if (v == null) return null;
  if (typeof v !== "string") throw new BadBody(`${field} must be a string`);
  return v.trim() || null;
};

const flag = (v: unknown, field: string): boolean | undefined => {
  if (v == null) return undefined;
  if (typeof v !== "boolean") throw new BadBody(`${field} must be true or false`);
  return v;
};

const LISTING_TEXT = ["status", "price", "beds", "baths", "sqft", "type", "address", "city", "agent", "brokerage"] as const;

function parseListing(v: unknown, i: number): PortfolioListing {
  if (v == null || typeof v !== "object") throw new BadBody(`listings[${i}] must be an object`);
  const o = v as Record<string, unknown>;
  const bookingId = text(o.bookingId, `listings[${i}].bookingId`);
  if (!bookingId) throw new BadBody(`listings[${i}].bookingId is required`);
  const listing = { bookingId } as PortfolioListing;
  for (const key of LISTING_TEXT) {
    const value = o[key];
    if (value != null && typeof value !== "string") throw new BadBody(`listings[${i}].${key} must be a string`);
    listing[key] = (value as string | undefined) ?? "";
  }
  return listing;
}

export function parseContent(raw: unknown): PortfolioContent {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) throw new BadBody("content must be an object");
  const c = raw as Record<string, unknown>;

  const video = text(c.video, "video");
  if (video && !(video in AGENT_PAGE_VIDEOS)) throw new BadBody(`video must be one of: ${Object.keys(AGENT_PAGE_VIDEOS).join(", ")}`);
  const leadPhoto = text(c.leadPhoto, "leadPhoto");
  // The last photo always closes the section, so it can't lead (the web's picker leaves it out).
  const leadable = AGENT_PAGE_PHOTOS.slice(0, -1).map((p) => p.key);
  if (leadPhoto && !leadable.includes(leadPhoto)) throw new BadBody(`leadPhoto must be one of: ${leadable.join(", ")}`);

  const listings = c.listings == null ? [] : c.listings;
  if (!Array.isArray(listings)) throw new BadBody("listings must be an array");

  // As the web builder: only an after photo is needed, and a before without it is dropped.
  const afterSrc = text(c.afterSrc, "afterSrc");
  const beforeSrc = afterSrc ? text(c.beforeSrc, "beforeSrc") : null;

  return {
    area: text(c.area, "area"),
    agentFirstName: text(c.agentFirstName, "agentFirstName"),
    brokerage: text(c.brokerage, "brokerage"),
    video,
    leadPhoto,
    showTourOfHomes: flag(c.showTourOfHomes, "showTourOfHomes") ?? true,
    showOffer: flag(c.showOffer, "showOffer") ?? true,
    beforeAfter: Boolean(afterSrc),
    beforeSrc,
    afterSrc,
    listings: listings.map(parseListing),
    ogImage: text(c.ogImage, "ogImage"),
  };
}
