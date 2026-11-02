import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { GALLERY_ORIGIN } from "@/lib/siteUrls";
import { getOrAssignGalleryToken } from "@/app/booked/actions";
import { badRequest, isUuid, notFound, optionalString, readJson, withErrors } from "../../../helpers";

/**
 * Attach a Dropbox folder to a booking and get its client gallery link →
 * `{ url }` (Flambient's "Upload Exports"). `{ dropboxFolderLink, replace? }`.
 * Only touches the link and the token: nothing is sent to anyone. A booking
 * that already has a different folder answers 409 `{ existing }` unless
 * `replace` is true, so a live gallery can't be swapped by accident. The token
 * never changes, so a link already sent keeps working either way.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const body = await readJson(req);
  const link = optionalString(body.dropboxFolderLink, "dropboxFolderLink")?.trim();
  if (!link) return badRequest("dropboxFolderLink is required");
  const [booking] = await db.select({ dropboxFolderLink: bookings.dropboxFolderLink }).from(bookings).where(eq(bookings.id, id));
  if (!booking) return notFound();
  if (booking.dropboxFolderLink && booking.dropboxFolderLink !== link && body.replace !== true) {
    return NextResponse.json({ existing: booking.dropboxFolderLink }, { status: 409 });
  }
  if (booking.dropboxFolderLink !== link) {
    await db.update(bookings).set({ dropboxFolderLink: link }).where(eq(bookings.id, id));
    revalidatePath("/booked");
  }
  const token = await getOrAssignGalleryToken(id);
  return NextResponse.json({ url: `${GALLERY_ORIGIN}/${token}` });
});
