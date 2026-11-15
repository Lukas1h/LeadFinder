/**
 * Where a subcontracted photographer's raw files go.
 *
 * A shooter only shoots; Lukas edits. So a booking that has a shooter gets its
 * own Dropbox upload folder — separate from the delivered-gallery folders
 * (bookings.dropboxFolderLink) — shared with an "anyone with the link can
 * edit" link. The folder and link are made the first time a shooter is put on
 * the job and the link is kept on the booking, so the booking dialog can copy
 * it or text it to the shooter without touching Dropbox again.
 *
 * The folder lives at `<DROPBOX_UPLOAD_ROOT>/<address>` (default
 * `/Media Uploads`), so all of them sit in one place to watch for uploads.
 * Note: creating a shared link needs the `sharing.write` scope on the Dropbox
 * app behind DROPBOX_REFRESH_TOKEN; app ep743bzg9eac546 has it, so a
 * missing_scope failure means that refresh token was issued before the scope
 * was switched on — re-run the OAuth flow (see .env.local.example).
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { bookings, listings, shooters } from "@/db/schema";
import { createUploadFolder } from "./dropbox";
import { firstName } from "./sms";

export interface BookingUploadLink {
  url?: string;
  /** The text to send the shooter — only when the booking's shooter has a phone. */
  text?: string;
  error?: string;
}

/**
 * The folder's name: the shoot's address, as Lukas described it. City stands
 * in when there's no street address, and a dated "Booking …" when there's
 * neither. Dropbox forbids "/" and a trailing dot or space, and caps names
 * well above this length; a reshoot at the same address gets Dropbox's own
 * "(1)" suffix rather than overwriting anything.
 */
export function uploadFolderName(
  address: string | null,
  city: string | null,
  jobDate: Date | null
): string {
  const base = (address ?? "").trim() || (city ?? "").trim() || `Booking${jobDate ? ` ${shootDay(jobDate)}` : ""}`;
  return base.replace(/[\\/]/g, "-").replace(/\s+/g, " ").replace(/[. ]+$/, "").slice(0, 200) || "Booking";
}

/** "Nov 18" — how a text should say the day. */
function shootDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The text Lukas sends a shooter with the upload folder link. */
export function shooterUploadText({
  shooterName,
  address,
  jobDate,
  url,
}: {
  shooterName: string;
  address: string | null;
  jobDate: Date | null;
  url: string;
}): string {
  const who = firstName(shooterName) ?? shooterName;
  const where = address ? ` for ${address}` : "";
  const when = jobDate ? ` (${shootDay(jobDate)})` : "";
  return `Hey ${who}, here's a Dropbox folder to upload the raw photos and video${where}${when}: ${url}\n\nAnyone with the link can add files, so no Dropbox login needed. Thanks!`;
}

/**
 * The job's Dropbox upload folder link, making the folder + link on first use.
 * Idempotent: once it's on the booking it's never re-made, so a link already
 * texted to a shooter keeps working.
 */
export async function getOrCreateBookingUploadLink(bookingId: string): Promise<BookingUploadLink> {
  const [row] = await db
    .select({
      uploadLink: bookings.dropboxUploadLink,
      address: bookings.address,
      city: bookings.city,
      listingAddress: listings.address,
      listingCity: listings.city,
      jobDate: bookings.jobDate,
      shooterName: shooters.name,
      shooterPhone: shooters.phone,
    })
    .from(bookings)
    .leftJoin(listings, eq(listings.id, bookings.listingId))
    .leftJoin(shooters, eq(shooters.id, bookings.shooterId))
    .where(eq(bookings.id, bookingId));
  if (!row) return { error: "No booking with that id" };

  const address = row.listingAddress ?? row.address ?? row.listingCity ?? row.city;

  let url = row.uploadLink;
  if (!url) {
    try {
      const created = await createUploadFolder(uploadFolderName(row.listingAddress ?? row.address, row.listingCity ?? row.city, row.jobDate));
      url = created.url;
      await db.update(bookings).set({ dropboxUploadLink: url }).where(eq(bookings.id, bookingId));
    } catch (err) {
      console.error("getOrCreateBookingUploadLink: Dropbox folder/link failed", err);
      const detail = err instanceof Error ? err.message : "";
      if (detail.includes("missing_scope")) {
        return {
          error:
            "Dropbox hasn't authorized this app to share links — re-run the OAuth flow for DROPBOX_REFRESH_TOKEN with the sharing.write scope.",
        };
      }
      return {
        error: detail.startsWith("Dropbox")
          ? detail
          : "Couldn't make the Dropbox upload link — check the Dropbox connection.",
      };
    }
    revalidatePath("/booked");
  }

  return {
    url,
    text:
      row.shooterName && row.shooterPhone
        ? shooterUploadText({ shooterName: row.shooterName, address, jobDate: row.jobDate, url })
        : undefined,
  };
}
