import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listGalleryMedia, getTemporaryLink } from "@/lib/dropbox";

/**
 * One gallery video — both the player's src and its Download button.
 * Redirects to a temporary direct Dropbox link (see getTemporaryLink) rather
 * than proxying the bytes, so a long 4K video costs no bandwidth here.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const [booking] = await db
    .select({ dropboxFolderLink: bookings.dropboxFolderLink })
    .from(bookings)
    .where(eq(bookings.galleryToken, token));
  if (!booking?.dropboxFolderLink) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Same rule as the thumbnail route: only files this booking's own folder lists.
  const { videos } = await listGalleryMedia(booking.dropboxFolderLink);
  const video = videos.find((v) => v.name === name);
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const response = NextResponse.redirect(await getTemporaryLink(video.pathLower), 302);
    // The player re-requests in ranges while streaming; let it reuse one link
    // for a while instead of minting a new one per range. Well inside its 4 hours.
    response.headers.set("Cache-Control", "private, max-age=1800");
    return response;
  } catch (err) {
    console.error("gallery video: temporary link failed", err);
    return NextResponse.json({ error: "Couldn't load that video" }, { status: 502 });
  }
}
