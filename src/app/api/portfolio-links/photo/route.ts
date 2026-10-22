import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getGalleryThumbnail, listGalleryMedia } from "@/lib/dropbox";

/**
 * Thumbnails for the portfolio-link builder (src/app/portfolio-links/new) —
 * admin-only (default session gate, not a public prefix), keyed by booking
 * id directly since there's no portfolio slug yet at pick time.
 */
export async function GET(req: NextRequest) {
  const bookingId = req.nextUrl.searchParams.get("bookingId");
  const name = req.nextUrl.searchParams.get("name");
  if (!bookingId || !name) return NextResponse.json({ error: "bookingId and name are required" }, { status: 400 });

  const [booking] = await db.select({ dropboxFolderLink: bookings.dropboxFolderLink }).from(bookings).where(eq(bookings.id, bookingId));
  if (!booking?.dropboxFolderLink) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { photos } = await listGalleryMedia(booking.dropboxFolderLink);
  const photo = photos.find((p) => p.name === name);
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await getGalleryThumbnail(photo.pathLower, "w256h256");
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}
