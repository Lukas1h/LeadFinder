"use server";

import { desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { agents, bookings, portfolioLinks, type PortfolioContent } from "@/db/schema";
import { listGalleryMedia } from "@/lib/dropbox";
import { createPortfolioLink, portfolioUrl } from "@/lib/portfolioLink";

export interface AgentMatch {
  id: string;
  name: string | null;
  phone: string | null;
}

export async function searchAgentsForPortfolio(query: string): Promise<AgentMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const like = `%${trimmed}%`;
  return db
    .select({ id: agents.id, name: agents.name, phone: agents.phone })
    .from(agents)
    .where(or(ilike(agents.name, like), ilike(agents.phone, like)))
    .orderBy(desc(agents.lastContactedAt))
    .limit(8);
}

export interface BookingMatch {
  id: string;
  address: string | null;
  city: string | null;
  label: string;
  hasGallery: boolean;
}

/** Bookings with a delivered gallery to pick from — a vacant "no photos yet" job has nothing to show. */
export async function searchBookingsForPortfolio(query: string): Promise<BookingMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const like = `%${trimmed}%`;
  const rows = await db
    .select({ id: bookings.id, address: bookings.address, city: bookings.city, dropboxFolderLink: bookings.dropboxFolderLink })
    .from(bookings)
    .where(or(ilike(bookings.address, like), ilike(bookings.city, like)))
    .orderBy(desc(bookings.completedAt))
    .limit(10);
  return rows.map((r) => ({
    id: r.id,
    address: r.address,
    city: r.city,
    label: [r.address, r.city].filter(Boolean).join(", ") || "Booking",
    hasGallery: Boolean(r.dropboxFolderLink),
  }));
}

/** A booking's delivered photo filenames, for picking which go into the portfolio or a house's carousel. */
export async function getBookingGalleryPhotos(bookingId: string): Promise<string[]> {
  const [booking] = await db.select({ dropboxFolderLink: bookings.dropboxFolderLink }).from(bookings).where(eq(bookings.id, bookingId));
  if (!booking?.dropboxFolderLink) return [];
  const { photos } = await listGalleryMedia(booking.dropboxFolderLink);
  return photos.map((p) => p.name);
}

export async function createPortfolioLinkAction(
  agentId: string | null,
  content: PortfolioContent
): Promise<{ slug: string; url: string }> {
  const { slug } = await createPortfolioLink(agentId, content);
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
