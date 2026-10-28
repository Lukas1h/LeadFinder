"use server";

import { and, asc, count, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  bookings,
  listings,
  messageSends,
  portfolioEvents,
  portfolioImages,
  portfolioLinks,
  portfolioSessions,
  portfolioTownImages,
  type PortfolioContent,
  type PortfolioEvent,
  type PortfolioListing,
} from "@/db/schema";
import { parseUserAgent } from "@/lib/galleryViews";
import { largestPhotoUrl } from "@/lib/photoEdit";
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
/**
 * Where an agent works, worked out now rather than read from agents.homeCity:
 * that column is filled nightly and only for warm-and-up agents, and a
 * portfolio link usually goes out the day someone first replies, before it
 * has been set. The city they list in most (newest wins a tie), else the
 * city of the listing he last texted them about.
 */
async function agentArea(agentId: string): Promise<string | null> {
  const [top] = await db
    .select({ city: sql<string>`initcap(lower(trim(${listings.city})))`, n: count() })
    .from(listings)
    .where(and(eq(listings.agentId, agentId), isNotNull(listings.city), sql`trim(${listings.city}) <> ''`))
    .groupBy(sql`1`)
    .orderBy(desc(count()), desc(sql`max(coalesce(${listings.listedAt}, ${listings.foundAt}))`))
    .limit(1);
  if (top?.city) return top.city;
  const [sent] = await db
    .select({ city: listings.city })
    .from(messageSends)
    .innerJoin(listings, eq(messageSends.listingId, listings.id))
    .where(and(eq(messageSends.agentId, agentId), isNotNull(listings.city)))
    .orderBy(desc(messageSends.sentAt))
    .limit(1);
  return sent?.city?.trim() || null;
}

export async function getPortfolioPrefill(agentId: string): Promise<PortfolioPrefill | null> {
  const [agent] = await db
    .select({ id: agents.id, name: agents.name, phone: agents.phone, email: agents.email, homeCity: agents.homeCity, brokerage: agents.brokerage })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agent) return null;

  const area = (await agentArea(agent.id)) ?? agent.homeCity?.trim() ?? "";
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
  visits: number;
  activeSeconds: number;
  contactSaves: number;
  bookTaps: number;
}

export async function listPortfolioLinks(): Promise<PortfolioLinkSummary[]> {
  const visits = db
    .select({
      linkId: portfolioSessions.linkId,
      visits: count().as("visits"),
      activeSeconds: sql<number>`coalesce(sum(${portfolioSessions.activeSeconds}), 0)::int`.as("active_seconds"),
    })
    .from(portfolioSessions)
    .groupBy(portfolioSessions.linkId)
    .as("visits");
  const taps = db
    .select({
      linkId: portfolioEvents.linkId,
      contactSaves: sql<number>`count(*) filter (where ${portfolioEvents.event} = 'save_contact')::int`.as("contact_saves"),
      bookTaps: sql<number>`count(*) filter (where ${portfolioEvents.event} = 'book_shoot')::int`.as("book_taps"),
    })
    .from(portfolioEvents)
    .groupBy(portfolioEvents.linkId)
    .as("taps");
  const rows = await db
    .select({
      id: portfolioLinks.id,
      slug: portfolioLinks.slug,
      agentName: agents.name,
      createdAt: portfolioLinks.createdAt,
      viewCount: portfolioLinks.viewCount,
      lastViewedAt: portfolioLinks.lastViewedAt,
      visits: visits.visits,
      activeSeconds: visits.activeSeconds,
      contactSaves: taps.contactSaves,
      bookTaps: taps.bookTaps,
    })
    .from(portfolioLinks)
    .leftJoin(agents, eq(agents.id, portfolioLinks.agentId))
    .leftJoin(visits, eq(visits.linkId, portfolioLinks.id))
    .leftJoin(taps, eq(taps.linkId, portfolioLinks.id))
    .orderBy(desc(portfolioLinks.createdAt))
    .limit(50);
  return rows.map((r) => ({
    ...r,
    url: portfolioUrl(r.slug),
    visits: r.visits ?? 0,
    activeSeconds: r.activeSeconds ?? 0,
    contactSaves: r.contactSaves ?? 0,
    bookTaps: r.bookTaps ?? 0,
  }));
}

export interface PortfolioVisit {
  id: string;
  startedAt: Date;
  lastSeenAt: Date;
  activeSeconds: number;
  maxScrollPct: number;
  sectionSeconds: Record<string, number>;
  screen: string | null;
  device: string;
  browser: string;
  location: string | null;
  ip: string | null;
  events: { id: string; event: PortfolioEvent; detail: string | null; at: Date }[];
}

export interface PortfolioActivity {
  id: string;
  slug: string;
  url: string;
  agentId: string | null;
  agentName: string | null;
  createdAt: Date;
  area: string | null;
  viewCount: number;
  visits: PortfolioVisit[];
}

/** Everything recorded for one link (src/app/portfolio/[slug]/tracker.tsx), newest visit first. */
export async function getPortfolioActivity(linkId: string): Promise<PortfolioActivity | null> {
  const [link] = await db
    .select({
      id: portfolioLinks.id,
      slug: portfolioLinks.slug,
      agentId: portfolioLinks.agentId,
      agentName: agents.name,
      createdAt: portfolioLinks.createdAt,
      content: portfolioLinks.content,
      viewCount: portfolioLinks.viewCount,
    })
    .from(portfolioLinks)
    .leftJoin(agents, eq(agents.id, portfolioLinks.agentId))
    .where(eq(portfolioLinks.id, linkId));
  if (!link) return null;

  const [sessions, events] = await Promise.all([
    db.select().from(portfolioSessions).where(eq(portfolioSessions.linkId, linkId)).orderBy(desc(portfolioSessions.startedAt)).limit(100),
    db.select().from(portfolioEvents).where(eq(portfolioEvents.linkId, linkId)).orderBy(asc(portfolioEvents.at)),
  ]);

  return {
    id: link.id,
    slug: link.slug,
    url: portfolioUrl(link.slug),
    agentId: link.agentId,
    agentName: link.agentName,
    createdAt: link.createdAt,
    area: link.content.area ?? null,
    viewCount: link.viewCount,
    visits: sessions.map((s) => {
      const { device, browser } = parseUserAgent(s.userAgent);
      return {
        id: s.id,
        startedAt: s.startedAt,
        lastSeenAt: s.lastSeenAt,
        activeSeconds: s.activeSeconds,
        maxScrollPct: s.maxScrollPct,
        sectionSeconds: s.sectionSeconds,
        screen: s.screen,
        device,
        browser,
        location: [s.city, s.region, s.country && s.country !== "US" ? s.country : null].filter(Boolean).join(", ") || null,
        ip: s.ip,
        events: events.filter((e) => e.sessionId === s.id).map((e) => ({ id: e.id, event: e.event, detail: e.detail, at: e.at })),
      };
    }),
  };
}

const LISTING_PHOTO_HOSTS = /^(photos\.zillowstatic\.com|(www\.)?compass\.com)$/;

/** A data: URL from the photo editor, or a listing photo URL fetched at its biggest size. */
async function imageBytes(src: string): Promise<{ data: Buffer; mimeType: string }> {
  const dataUrl = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(src);
  if (dataUrl) return { mimeType: dataUrl[1], data: Buffer.from(dataUrl[2], "base64") };
  const url = new URL(src);
  if (url.protocol !== "https:" || !LISTING_PHOTO_HOSTS.test(url.hostname)) throw new Error("Not a listing photo");
  let res = await fetch(largestPhotoUrl(src));
  if (!res.ok) res = await fetch(src);
  if (!res.ok) throw new Error("Couldn't fetch the original photo");
  return { mimeType: res.headers.get("content-type") ?? "image/jpeg", data: Buffer.from(await res.arrayBuffer()) };
}

/** Saves a before/after (photo editor data URLs or listing photo URLs) as page images; returns their public URLs. */
export async function saveBeforeAfter(input: { before: string; after: string }): Promise<{ beforeSrc: string; afterSrc: string }> {
  const [before, after] = await Promise.all([imageBytes(input.before), imageBytes(input.after)]);
  const rows = await db.insert(portfolioImages).values([before, after]).returning({ id: portfolioImages.id });
  return { beforeSrc: `/api/portfolio-image/${rows[0].id}`, afterSrc: `/api/portfolio-image/${rows[1].id}` };
}

/**
 * The standalone photo editor's "Use on agent page": saves the before/after
 * and returns the builder URL with them filled in — and the listing's agent
 * picked, so the page is about their own listing.
 */
export async function saveEditForAgentPage(input: { before: string; after: string; listingId: string | null }): Promise<{ href: string }> {
  const { beforeSrc, afterSrc } = await saveBeforeAfter(input);
  const params = new URLSearchParams({ before: beforeSrc.split("/").pop()!, after: afterSrc.split("/").pop()! });
  if (input.listingId) {
    const [listing] = await db.select({ agentId: listings.agentId }).from(listings).where(eq(listings.id, input.listingId));
    if (listing?.agentId) params.set("agent", listing.agentId);
  }
  return { href: `/portfolio-links/new?${params}` };
}

/** Every photo from every listing of theirs on file, newest listing first — the builder's "Edit a photo from their listing". */
export async function getAgentListingPhotos(agentId: string): Promise<{ label: string; photos: string[] }[]> {
  const rows = await db
    .select({ address: listings.address, city: listings.city, photos: listings.photos })
    .from(listings)
    .where(and(eq(listings.agentId, agentId), isNotNull(listings.photos)))
    .orderBy(sql`${listings.listedAt} desc nulls last`, desc(listings.foundAt))
    .limit(30);
  return rows
    .filter((r) => (r.photos?.length ?? 0) > 0)
    .map((r) => ({ label: [r.address, r.city].filter(Boolean).join(", ") || "Listing", photos: r.photos! }));
}

/** An existing link, as the builder's starting state for editing it. */
export async function getPortfolioLinkForEdit(linkId: string): Promise<{
  linkId: string;
  url: string;
  agent: AgentMatch | null;
  content: PortfolioContent;
} | null> {
  const [row] = await db
    .select({ id: portfolioLinks.id, slug: portfolioLinks.slug, content: portfolioLinks.content, agentId: portfolioLinks.agentId })
    .from(portfolioLinks)
    .where(eq(portfolioLinks.id, linkId));
  if (!row) return null;
  const [agent] = row.agentId
    ? await db.select({ id: agents.id, name: agents.name, phone: agents.phone, email: agents.email }).from(agents).where(eq(agents.id, row.agentId))
    : [];
  return { linkId: row.id, url: portfolioUrl(row.slug), agent: agent ?? null, content: row.content };
}

/** Saves changes to a link in place — same URL, same activity. */
export async function updatePortfolioLinkAction(linkId: string, agentId: string | null, content: PortfolioContent): Promise<{ slug: string; url: string }> {
  const [row] = await db.update(portfolioLinks).set({ agentId, content }).where(eq(portfolioLinks.id, linkId)).returning({ slug: portfolioLinks.slug });
  if (!row) throw new Error("That link no longer exists");
  return { slug: row.slug, url: portfolioUrl(row.slug) };
}

export interface TownImage {
  town: string;
  label: string;
  imageSrc: string;
}

/** The town photos (link previews for pages without a before/after), A–Z. */
export async function listTownImages(): Promise<TownImage[]> {
  return db
    .select({ town: portfolioTownImages.town, label: portfolioTownImages.label, imageSrc: portfolioTownImages.imageSrc })
    .from(portfolioTownImages)
    .orderBy(asc(portfolioTownImages.town));
}

/** Areas links already use, or agents list in, that have no town photo yet, most common first. */
export async function townsWithoutImages(): Promise<string[]> {
  const rows = await db.execute<{ town: string }>(sql`
    select initcap(t.town) as town from (
      select lower(trim(content->>'area')) as town from portfolio_links where coalesce(trim(content->>'area'), '') <> ''
      union all
      select lower(trim(home_city)) from agents where coalesce(trim(home_city), '') <> ''
    ) t
    where t.town not in (select town from portfolio_town_images)
    group by t.town order by count(*) desc limit 20`);
  return rows.rows.map((r) => r.town);
}

export async function saveTownImage(label: string, imageSrc: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Which town is it?");
  if (!/^\/api\/portfolio-image\/[0-9a-f-]{36}$/i.test(imageSrc)) throw new Error("Upload a photo first");
  await db
    .insert(portfolioTownImages)
    .values({ town: trimmed.toLowerCase(), label: trimmed, imageSrc })
    .onConflictDoUpdate({ target: portfolioTownImages.town, set: { label: trimmed, imageSrc, updatedAt: new Date() } });
}

export async function deleteTownImage(town: string): Promise<void> {
  await db.delete(portfolioTownImages).where(eq(portfolioTownImages.town, town));
}
