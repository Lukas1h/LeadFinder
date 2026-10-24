import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings, portfolioLinks } from "@/db/schema";
import { getGalleryThumbnail, listGalleryMedia } from "@/lib/dropbox";
import { listingCardPhotoNames } from "@/lib/listingCardPhotos";

/**
 * A "Recent listings" card photo on a public agent page — same
 * validate-before-serve pattern as /api/gallery/[token]/thumbnail: only for a
 * booking that page's content lists, and only a photo its card shows
 * (lib/listingCardPhotos.ts), still in the booking's Dropbox folder now.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bookingId = req.nextUrl.searchParams.get("bookingId");
  const name = req.nextUrl.searchParams.get("name");
  if (!bookingId || !name) return NextResponse.json({ error: "bookingId and name are required" }, { status: 400 });

  const [link] = await db.select({ content: portfolioLinks.content }).from(portfolioLinks).where(eq(portfolioLinks.slug, slug));
  const referenced = link?.content.listings?.some((l) => l.bookingId === bookingId);
  if (!referenced) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [booking] = await db.select({ dropboxFolderLink: bookings.dropboxFolderLink }).from(bookings).where(eq(bookings.id, bookingId));
  if (!booking?.dropboxFolderLink) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only the photos that card actually shows, never an arbitrary file from the folder.
  const [{ photos }, shown] = await Promise.all([listGalleryMedia(booking.dropboxFolderLink), listingCardPhotoNames(booking.dropboxFolderLink)]);
  const photo = shown.includes(name) ? photos.find((p) => p.name === name) : undefined;
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const bytes = await getGalleryThumbnail(photo.pathLower, "w960h640");
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
    });
  } catch (err) {
    console.error("agent page listing photo: thumbnail failed", err);
    return NextResponse.json({ error: "Couldn't load that photo" }, { status: 502 });
  }
}
