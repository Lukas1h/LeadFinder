import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { getGalleryThumbnail, listGalleryMedia } from "@/lib/dropbox";

/**
 * A small thumbnail of any delivered photo in a booking's Dropbox folder, for
 * the "Highlight photos" picker. Admin only (proxy.ts gates /api/bookings).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const [booking] = await db.select({ dropboxFolderLink: bookings.dropboxFolderLink }).from(bookings).where(eq(bookings.id, id));
  if (!booking?.dropboxFolderLink) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { photos } = await listGalleryMedia(booking.dropboxFolderLink);
  const photo = photos.find((p) => p.name === name);
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const bytes = await getGalleryThumbnail(photo.pathLower, "w480h320");
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
    });
  } catch (err) {
    console.error("booking photo: thumbnail failed", err);
    return NextResponse.json({ error: "Couldn't load that photo" }, { status: 502 });
  }
}
