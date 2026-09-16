import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listGalleryPhotos, getGalleryThumbnail, type GalleryThumbnailSize } from "@/lib/dropbox";

const VALID_SIZES = new Set<GalleryThumbnailSize>(["w256h256", "w480h320", "w640h480", "w960h640", "w1024h768", "w2048h1536"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const sizeParam = req.nextUrl.searchParams.get("size") ?? "w640h480";
  const size = VALID_SIZES.has(sizeParam as GalleryThumbnailSize) ? (sizeParam as GalleryThumbnailSize) : "w640h480";

  const [booking] = await db
    .select({ dropboxFolderLink: bookings.dropboxFolderLink })
    .from(bookings)
    .where(eq(bookings.galleryToken, token));
  if (!booking?.dropboxFolderLink) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Never trust a client-supplied path/name directly against the Dropbox
  // API — only serve a thumbnail for a file this specific booking's own
  // folder actually lists, so a valid galleryToken can't be used to probe
  // arbitrary paths elsewhere in the Dropbox account.
  const photos = await listGalleryPhotos(booking.dropboxFolderLink);
  const photo = photos.find((p) => p.name === name);
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const bytes = await getGalleryThumbnail(photo.pathLower, size);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        // A given photo+size always renders the same bytes for as long as
        // it exists in Dropbox, so cache hard — this is what keeps a
        // gallery of dozens of photos loading fast on repeat views.
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    console.error("gallery thumbnail: fetch failed", err);
    return NextResponse.json({ error: "Couldn't load that photo" }, { status: 502 });
  }
}
