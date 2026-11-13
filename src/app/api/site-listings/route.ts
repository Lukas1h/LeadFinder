import { connection, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { listingCardPhotoNames } from "@/lib/listingCardPhotos";
import { getSiteListings } from "@/lib/siteListings";
import { PORTFOLIO_ORIGIN } from "@/lib/siteUrls";

/**
 * The main website's "Recent listings" section (the lukashahnart project
 * fetches this when it renders): each card the same as an agent page's, with
 * absolute photo URLs served by ./photo. Public: only jobs Lukas picked to
 * show (lib/siteListings.ts), nothing about who booked them.
 */
export async function GET() {
  // Picked in the app at any time, so never prerendered at build.
  await connection();
  const listings = await getSiteListings();
  const rows = listings.length
    ? await db
        .select({ id: bookings.id, link: bookings.dropboxFolderLink, highlights: bookings.highlightPhotos })
        .from(bookings)
        .where(inArray(bookings.id, listings.map((l) => l.bookingId)))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cards = await Promise.all(
    listings.map(async (l) => {
      const row = byId.get(l.bookingId);
      const names = row?.link ? await listingCardPhotoNames(row.link, row.highlights).catch(() => []) : [];
      return {
        ...l,
        photos: names.map(
          (name) => `${PORTFOLIO_ORIGIN}/api/site-listings/photo?bookingId=${l.bookingId}&name=${encodeURIComponent(name)}`
        ),
      };
    })
  );
  return NextResponse.json({ listings: cards }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
