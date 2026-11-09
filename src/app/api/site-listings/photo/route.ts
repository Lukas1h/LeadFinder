import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { getGalleryThumbnail, listGalleryMedia } from "@/lib/dropbox";
import { listingCardPhotoNames } from "@/lib/listingCardPhotos";
import { getSiteListings } from "@/lib/siteListings";

/**
 * A "Recent listings" card photo on the main website — the same checks as an
 * agent page's (/api/portfolio/[slug]/listing-photo): only for a job the site
 * shows right now, and only a photo its card shows.
 */
export async function GET(req: NextRequest) {
  const bookingId = req.nextUrl.searchParams.get("bookingId");
  const name = req.nextUrl.searchParams.get("name");
  if (!bookingId || !name) return NextResponse.json({ error: "bookingId and name are required" }, { status: 400 });

  const shownJobs = await getSiteListings();
  if (!shownJobs.some((l) => l.bookingId === bookingId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [booking] = await db.select({ dropboxFolderLink: bookings.dropboxFolderLink }).from(bookings).where(eq(bookings.id, bookingId));
  if (!booking?.dropboxFolderLink) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ photos }, shown] = await Promise.all([listGalleryMedia(booking.dropboxFolderLink), listingCardPhotoNames(booking.dropboxFolderLink)]);
  const photo = shown.includes(name) ? photos.find((p) => p.name === name) : undefined;
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const bytes = await getGalleryThumbnail(photo.pathLower, "w960h640");
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
    });
  } catch (err) {
    console.error("site listing photo: thumbnail failed", err);
    return NextResponse.json({ error: "Couldn't load that photo" }, { status: 502 });
  }
}
