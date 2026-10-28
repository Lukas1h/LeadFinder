import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { GALLERY_ORIGIN } from "@/lib/siteUrls";
import { getOrAssignShareToken } from "@/app/booked/actions";
import { badRequest, isUuid, notFound, withErrors } from "../../../helpers";

/**
 * The gallery's share link for someone who isn't the client → `{ url }`:
 * the same photos, no invoice or payment, first photo as a hero. Made on
 * first call, the same URL every time after.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [booking] = await db.select({ dropboxFolderLink: bookings.dropboxFolderLink }).from(bookings).where(eq(bookings.id, id));
  if (!booking) return notFound();
  if (!booking.dropboxFolderLink) return badRequest("Add the gallery's Dropbox folder first");
  const token = await getOrAssignShareToken(id);
  return NextResponse.json({ url: `${GALLERY_ORIGIN}/${token}` });
});
