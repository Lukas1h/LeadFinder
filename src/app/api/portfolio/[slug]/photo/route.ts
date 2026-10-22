import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bookings, portfolioLinks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getGalleryThumbnail, listGalleryMedia, type GalleryThumbnailSize } from "@/lib/dropbox";

const VALID_SIZES = new Set<GalleryThumbnailSize>(["w256h256", "w480h320", "w640h480", "w960h640", "w1024h768", "w2048h1536"]);

/**
 * A photo on a public portfolio page (/portfolio/[slug]) — same pattern as
 * /api/gallery/[token]/thumbnail, just keyed by the portfolio slug instead
 * of a booking's own galleryToken: a name is only ever served if the page's
 * own saved content actually references it, on a booking that content
 * actually names, never an arbitrary path probe.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = req.nextUrl.searchParams.get("name");
  const bookingId = req.nextUrl.searchParams.get("bookingId");
  if (!name || !bookingId) return NextResponse.json({ error: "name and bookingId are required" }, { status: 400 });

  const sizeParam = req.nextUrl.searchParams.get("size") ?? "w640h480";
  const size = VALID_SIZES.has(sizeParam as GalleryThumbnailSize) ? (sizeParam as GalleryThumbnailSize) : "w640h480";

  const [link] = await db.select({ content: portfolioLinks.content }).from(portfolioLinks).where(eq(portfolioLinks.slug, slug));
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const referenced =
    link.content.photos.some((p) => p.bookingId === bookingId && p.name === name) ||
    link.content.houses.some((h) => h.bookingId === bookingId && h.photos.includes(name));
  if (!referenced) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [booking] = await db.select({ dropboxFolderLink: bookings.dropboxFolderLink }).from(bookings).where(eq(bookings.id, bookingId));
  if (!booking?.dropboxFolderLink) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Belt and suspenders, same as the gallery route: the name has to actually
  // be in that booking's Dropbox folder right now, not just in the saved content.
  const { photos } = await listGalleryMedia(booking.dropboxFolderLink);
  const photo = photos.find((p) => p.name === name);
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const bytes = await getGalleryThumbnail(photo.pathLower, size);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400, immutable" },
    });
  } catch (err) {
    console.error("portfolio photo: thumbnail failed", err);
    return NextResponse.json({ error: "Couldn't load that photo" }, { status: 502 });
  }
}
