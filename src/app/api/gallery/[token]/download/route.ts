import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/db";
import { byGalleryToken } from "@/lib/galleryToken";
import { bookings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resolveZipDownloadUrl } from "@/lib/dropbox";
import { recordGalleryEvent } from "@/lib/galleryViews";

/** The gallery's "Download all" — redirects to Dropbox's direct zip URL (see resolveZipDownloadUrl). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [booking] = await db
    .select({ id: bookings.id, dropboxFolderLink: bookings.dropboxFolderLink, shareToken: bookings.shareToken })
    .from(bookings)
    .where(byGalleryToken(token));
  if (!booking?.dropboxFolderLink) return NextResponse.json({ error: "Not found" }, { status: 404 });

  after(() => recordGalleryEvent(booking.id, "download_all", req.headers, booking.shareToken === token ? "shared link" : undefined));

  // Each lookup mints a fresh one-off zip URL, so never cache the redirect.
  const response = NextResponse.redirect(await resolveZipDownloadUrl(booking.dropboxFolderLink), 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
