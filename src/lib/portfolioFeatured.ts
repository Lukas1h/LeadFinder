import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookingLineItems, bookings, listings } from "@/db/schema";
import { CARD_PHOTOS, listingCardPhotoNames } from "@/lib/listingCardPhotos";

/**
 * One of Lukas's shoots as a portfolio page's lead section ("featured shoot",
 * 2026-11-15): the property, its photos and what he charged for it, read live
 * so the page always shows the job as it is now.
 */
export interface FeaturedShoot {
  bookingId: string;
  /** The street address as it reads on a card: the linked listing's, else the booking's. */
  address: string;
  city: string | null;
  /** Up to 10, in highlight order, served through /api/portfolio/[slug]/listing-photo. */
  photoUrls: string[];
  /** e.g. "Photos + drone", from the booking's line item descriptions; null when it has none. */
  packageLabel: string | null;
  /** Dollars, the sum of the line items; null when there are none. */
  price: number | null;
}

/**
 * The page's featured shoot, or null when there isn't one to lead with: no
 * such booking, or no gallery folder. Same photos as a "Recent listings"
 * card (bookings.highlight_photos, else the even spread), served by the
 * slug-scoped route — which allows the booking on a page whose
 * content.featuredBookingId points at it. A folder that can't be listed right
 * now (Dropbox down, a moved folder) comes back with no photos rather than
 * hiding the shoot's address and price too.
 */
export async function getFeaturedShoot(bookingId: string, slug: string): Promise<FeaturedShoot | null> {
  const [row] = await db
    .select({
      id: bookings.id,
      address: bookings.address,
      city: bookings.city,
      folder: bookings.dropboxFolderLink,
      highlights: bookings.highlightPhotos,
      listingAddress: listings.address,
      listingCity: listings.city,
    })
    .from(bookings)
    .leftJoin(listings, eq(listings.id, bookings.listingId))
    .where(eq(bookings.id, bookingId));
  if (!row?.folder) return null;

  // A linked listing's address wins, as it does everywhere else.
  const address = (row.listingAddress ?? row.address ?? "").trim();
  const city = (row.listingCity ?? row.city)?.trim() || null;

  const names = await listingCardPhotoNames(row.folder, row.highlights).catch(() => []);
  const photoUrls = names
    .slice(0, CARD_PHOTOS)
    .map((name) => `/api/portfolio/${encodeURIComponent(slug)}/listing-photo?bookingId=${bookingId}&name=${encodeURIComponent(name)}`);

  // Line item amounts are whole dollars (booking_line_items.amount).
  const items = await db
    .select({ description: bookingLineItems.description, amount: bookingLineItems.amount })
    .from(bookingLineItems)
    .where(eq(bookingLineItems.bookingId, bookingId));
  const packageLabel = items.map((i) => i.description.trim()).filter(Boolean).join(" + ") || null;
  const price = items.length ? items.reduce((sum, i) => sum + i.amount, 0) : null;

  return { bookingId, address, city, photoUrls, packageLabel, price };
}
