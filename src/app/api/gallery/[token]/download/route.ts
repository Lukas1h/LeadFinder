import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resolveZipDownloadUrl } from "@/lib/dropbox";

/** The gallery's "Download all" — redirects to Dropbox's direct zip URL (see resolveZipDownloadUrl). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [booking] = await db
    .select({ dropboxFolderLink: bookings.dropboxFolderLink })
    .from(bookings)
    .where(eq(bookings.galleryToken, token));
  if (!booking?.dropboxFolderLink) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Each lookup mints a fresh one-off zip URL, so never cache the redirect.
  const response = NextResponse.redirect(await resolveZipDownloadUrl(booking.dropboxFolderLink), 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
