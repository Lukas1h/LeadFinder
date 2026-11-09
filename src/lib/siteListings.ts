import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, bookings, type PortfolioListing } from "@/db/schema";
import { finishedJobs } from "@/lib/portfolioJobs";

/** Cards shown when none are picked: the newest finished jobs. */
const DEFAULT_COUNT = 3;

/** The ids picked on /portfolio-links/settings, in order; empty = none picked. */
export async function getSiteListingIds(): Promise<string[]> {
  const [row] = await db.select({ ids: appSettings.siteListingIds }).from(appSettings).limit(1);
  return row?.ids ?? [];
}

/**
 * The main website's "Recent listings" (lukashahn.media, via
 * /api/site-listings): the picked jobs in the order picked, or with none
 * picked the three newest finished jobs. Built live, so a sold listing's
 * badge changes on its own.
 */
export async function getSiteListings(): Promise<PortfolioListing[]> {
  const ids = await getSiteListingIds();
  if (ids.length === 0) return (await finishedJobs(undefined, DEFAULT_COUNT)).map((j) => j.listing);
  const jobs = await finishedJobs(inArray(bookings.id, ids), ids.length);
  const byId = new Map(jobs.map((j) => [j.listing.bookingId, j.listing]));
  return ids.map((id) => byId.get(id)).filter((l): l is PortfolioListing => Boolean(l));
}
