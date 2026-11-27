import type { PortfolioContent, PortfolioListing } from "@/db/schema";
import { AGENT_PAGE_PHOTOS, AGENT_PAGE_VIDEOS } from "@/lib/agentPage";
import { BadBody } from "../helpers";
import { LUKAS_PHONES, isLukasPhone } from "@/lib/lukasPhones";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // The last photo always closes the section, so it can't lead (the web's picker leaves it out).
  // A key that isn't in the set (a retired port-N from before the 2026-11-12 photos) is dropped,
  // so re-saving an older link still works; the page then leads with the first photo.
  const leadable = AGENT_PAGE_PHOTOS.slice(0, -1).map((p) => p.key);
  const requestedLead = text(c.leadPhoto, "leadPhoto");
  const leadPhoto = requestedLead && leadable.includes(requestedLead) ? requestedLead : null;

  const listings = c.listings == null ? [] : c.listings;
  if (!Array.isArray(listings)) throw new BadBody("listings must be an array");

  // As the web builder: only an after photo is needed, and a before without it is dropped.
  const afterSrc = text(c.afterSrc, "afterSrc");
  const beforeSrc = afterSrc ? text(c.beforeSrc, "beforeSrc") : null;

  // The featured shoot (lib/portfolioFeatured.ts): its id is passed through as
  // the builder sends it back, so saving an existing page keeps its lead.
  const featuredBookingId = text(c.featuredBookingId, "featuredBookingId");
  if (featuredBookingId && !UUID_RE.test(featuredBookingId)) throw new BadBody("featuredBookingId must be a booking id");

  // Lukas's number on the page (lib/lukasPhones.ts); omitted/null = Auto.
  const myPhone = text(c.myPhone, "myPhone");
  if (myPhone && !isLukasPhone(myPhone)) throw new BadBody(`myPhone must be one of: ${LUKAS_PHONES.map((p) => p.e164).join(", ")}`);

  return {
    area: text(c.area, "area"),
    agentFirstName: text(c.agentFirstName, "agentFirstName"),
    brokerage: text(c.brokerage, "brokerage"),
    video,
    leadPhoto,
    showTourOfHomes: flag(c.showTourOfHomes, "showTourOfHomes") ?? true,
    showOffer: flag(c.showOffer, "showOffer") ?? true,
    newStyle: flag(c.newStyle, "newStyle") ?? true,
    beforeAfter: Boolean(afterSrc),
    beforeSrc,
    afterSrc,
    listings: listings.map(parseListing),
    ogImage: text(c.ogImage, "ogImage"),
    // Left out (iPhone builds without the picker) keeps the saved pick.
    ...(c.myPhone === undefined ? {} : { myPhone }),
    // Left out entirely (an older iPhone build) keeps the saved one; an
    // explicit null removes it (updatePortfolioLinkAction).
    ...(c.featuredBookingId === undefined ? {} : { featuredBookingId }),
  };
}
