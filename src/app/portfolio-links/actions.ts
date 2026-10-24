"use server";

import { and, desc, eq, ilike, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { agents, bookings, listings, portfolioImages, portfolioLinks, type PortfolioContent, type PortfolioListing } from "@/db/schema";
import { listGalleryMedia } from "@/lib/dropbox";
import { agentPageRegion } from "@/lib/agentPage";
import { formatPrice } from "@/lib/format";
import { marketNews } from "@/lib/marketStatus";
import { createPortfolioLink, portfolioUrl } from "@/lib/portfolioLink";

export interface AgentMatch {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

/** Same name search as the booking form's contact field. */
export async function searchAgentsForPortfolio(query: string): Promise<AgentMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return db
    .select({ id: agents.id, name: agents.name, phone: agents.phone, email: agents.email })
    .from(agents)
    .where(and(isNotNull(agents.name), ilike(agents.name, `%${trimmed}%`)))
    .orderBy(desc(agents.lastContactedAt))
    .limit(8);
}

export interface PortfolioPrefill {
  agent: AgentMatch;
  firstName: string;
  area: string;
  brokerage: string;
  listings: PortfolioListing[];
}

const LISTINGS_PREFILLED = 3;

/**
 * Everything the builder fills in when an agent is picked: their first name,
 * where they list, their brokerage, and Lukas's own finished (completed or
 * invoiced) jobs with a gallery, nearest first — same city, then same side of
 * the valley — as editable listing cards.
 */
export async function getPortfolioPrefill(agentId: string): Promise<PortfolioPrefill | null> {
  const [agent] = await db
    .select({ id: agents.id, name: agents.name, phone: agents.phone, email: agents.email, homeCity: agents.homeCity, brokerage: agents.brokerage })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agent) return null;

  const area = agent.homeCity?.trim() || "Eugene";
  const jobs = await finishedJobs();
  const city = area.toLowerCase();
  const region = agentPageRegion(area);
  const rank = (jobCity: string) => (jobCity.toLowerCase() === city ? 0 : agentPageRegion(jobCity) === region ? 1 : 2);
  const nearest = jobs
    .map((j, i) => ({ ...j, i }))
    .sort((a, b) => rank(a.city) - rank(b.city) || a.i - b.i)
    .slice(0, LISTINGS_PREFILLED)
    .map((j) => j.listing);

  return {
    agent: { id: agent.id, name: agent.name, phone: agent.phone, email: agent.email },
    firstName: agent.name?.trim().split(/\s+/)[0] ?? "",
    area,
    brokerage: agent.brokerage ?? "",
    listings: nearest,
  };
}

/** For adding a job to the listings by hand — finished jobs only, matched on address or city. */
export async function searchJobsForPortfolio(query: string): Promise<PortfolioListing[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const like = `%${trimmed}%`;
  return (await finishedJobs(or(ilike(bookings.address, like), ilike(bookings.city, like)), 8)).map((j) => j.listing);
}

/** Finished jobs with a gallery, newest first, as listing cards — plus the bare city, for ranking by distance. */
async function finishedJobs(extra?: ReturnType<typeof or>, limit = 60): Promise<{ listing: PortfolioListing; city: string }[]> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      address: bookings.address,
      city: bookings.city,
      state: bookings.state,
      completedAt: bookings.completedAt,
      invoicedAt: bookings.invoicedAt,
      marketStatus: bookings.marketStatus,
      price: listings.price,
      beds: listings.bedrooms,
      baths: listings.bathrooms,
      sqft: listings.livingArea,
      homeType: listings.homeType,
      zipcode: listings.zipcode,
      listingAgent: listings.agentName,
      listingBroker: listings.brokerName,
      contactName: agents.name,
      contactBrokerage: agents.brokerage,
    })
    .from(bookings)
    .leftJoin(listings, eq(listings.id, bookings.listingId))
    .leftJoin(agents, eq(agents.id, bookings.contactAgentId))
    .where(and(isNotNull(bookings.dropboxFolderLink), or(isNotNull(bookings.completedAt), isNotNull(bookings.invoicedAt)), extra))
    .orderBy(desc(bookings.completedAt), desc(bookings.invoicedAt))
    .limit(limit);

  return rows.map((r) => {
    const finished = r.completedAt ?? r.invoicedAt;
    const recent = finished != null && Date.now() - finished.getTime() < 45 * 24 * 60 * 60 * 1000;
    const listing: PortfolioListing = {
      bookingId: r.bookingId,
      status: marketLabel(r.marketStatus) ?? (recent ? "Just listed" : "Recent work"),
      price: r.price != null ? formatPrice(r.price) : "",
      beds: r.beds != null ? String(Number(r.beds)) : "",
      baths: r.baths != null ? String(Number(r.baths)) : "",
      sqft: r.sqft != null ? r.sqft.toLocaleString("en-US") : "",
      type: homeTypeLabel(r.homeType),
      address: r.address ?? "",
      city: [r.city, [r.state ?? "OR", r.zipcode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      agent: r.listingAgent ?? r.contactName ?? "",
      brokerage: r.listingBroker ?? r.contactBrokerage ?? "",
      photos: [],
    };
    return { listing, city: r.city ?? "" };
  });
}

/** The card badge for a job whose listing has moved on (lib/marketStatus.ts's nightly check). */
function marketLabel(status: string | null): string | null {
  const kind = marketNews(status);
  return kind === "sold" ? "Sold" : kind === "pending" ? "Pending" : kind === "under_contract" ? "Under contract" : null;
}

/** Zillow's "SINGLE_FAMILY" → "Single family". */
function homeTypeLabel(homeType: string | null): string {
  if (!homeType) return "";
  const words = homeType.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** A before/after photo for the page; returns the public URL to store in the content. */
export async function uploadPortfolioImage(formData: FormData): Promise<{ url: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) throw new Error("That isn't an image");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Image is too big (8 MB max)");
  const [row] = await db
    .insert(portfolioImages)
    .values({ mimeType: file.type, data: Buffer.from(await file.arrayBuffer()) })
    .returning({ id: portfolioImages.id });
  return { url: `/api/portfolio-image/${row.id}` };
}

const PHOTOS_PER_LISTING = 8;

export async function createPortfolioLinkAction(
  agentId: string | null,
  content: PortfolioContent
): Promise<{ slug: string; url: string }> {
  // Each card's carousel is the first few photos of that job's gallery, as it is now.
  const withPhotos = await Promise.all(
    (content.listings ?? []).map(async (l) => {
      const [booking] = await db.select({ link: bookings.dropboxFolderLink }).from(bookings).where(eq(bookings.id, l.bookingId));
      if (!booking?.link) throw new Error(`${l.address || "A listing"} has no gallery`);
      const { photos } = await listGalleryMedia(booking.link).catch(() => {
        throw new Error(`Couldn't read the gallery for ${l.address || "a listing"}`);
      });
      return { ...l, photos: photos.slice(0, PHOTOS_PER_LISTING).map((p) => p.name) };
    })
  );
  const { slug } = await createPortfolioLink(agentId, { ...content, listings: withPhotos });
  return { slug, url: portfolioUrl(slug) };
}

export interface PortfolioLinkSummary {
  id: string;
  slug: string;
  url: string;
  agentName: string | null;
  createdAt: Date;
  viewCount: number;
  lastViewedAt: Date | null;
}

export async function listPortfolioLinks(): Promise<PortfolioLinkSummary[]> {
  const rows = await db
    .select({
      id: portfolioLinks.id,
      slug: portfolioLinks.slug,
      agentName: agents.name,
      createdAt: portfolioLinks.createdAt,
      viewCount: portfolioLinks.viewCount,
      lastViewedAt: portfolioLinks.lastViewedAt,
    })
    .from(portfolioLinks)
    .leftJoin(agents, eq(agents.id, portfolioLinks.agentId))
    .orderBy(desc(portfolioLinks.createdAt))
    .limit(50);
  return rows.map((r) => ({ ...r, url: portfolioUrl(r.slug) }));
}
