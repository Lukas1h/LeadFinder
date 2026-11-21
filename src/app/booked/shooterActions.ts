"use server";

/**
 * The Booked page's shooter actions — thin wrappers around lib/shooters, which
 * owns the writes (and their revalidation) so the phone API and the MCP tools
 * log a payment exactly the way the web does.
 */

import { listShooters, setBookingShooter, setShooterPaid } from "@/lib/shooters";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { dropboxWebUrl } from "@/lib/dropbox";
import { getOrCreateBookingUploadLink, loadUploadStatus, uploadPageUrl, type BookingUploadStatus } from "@/lib/mediaUploads";

/** Attaches a shooter (and pay, and phone) to a booking; a null / blank name clears it. */
export async function saveBookingShooter(
  bookingId: string,
  input: { name: string; pay: number | null; phone?: string | null } | null
): Promise<{ error?: string }> {
  return setBookingShooter(bookingId, input);
}

/** "Paid <name>": logs (or removes) the pay as a Subcontractors expense on the job. */
export async function markShooterPaid(bookingId: string, paid: boolean): Promise<{ error?: string }> {
  return setShooterPaid(bookingId, paid);
}

/** Every shooter on file, for the booking form's picker. */
export async function getShooters(): Promise<{ id: string; name: string }[]> {
  return listShooters();
}

/**
 * The job's Dropbox upload folder link — made on first use — plus the text to
 * send the shooter (see src/lib/mediaUploads.ts). Never re-made once stored,
 * so a link already texted keeps working.
 */
export async function getBookingUploadLink(
  bookingId: string
): Promise<{ url?: string; text?: string; error?: string }> {
  return getOrCreateBookingUploadLink(bookingId);
}

/**
 * What the booking dialog shows under the shooter: the upload page link (if
 * made), the Dropbox folder, and whether the shooter has opened it, is
 * uploading, stalled or finished. Read live each time the dialog opens.
 */
export async function getBookingUploadStatus(bookingId: string): Promise<{
  url: string | null;
  dropboxUrl: string | null;
  status: BookingUploadStatus;
}> {
  const [row] = await db
    .select({ token: bookings.uploadToken, path: bookings.dropboxUploadPath })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return {
    url: row?.token ? uploadPageUrl(row.token) : null,
    dropboxUrl: row?.path ? dropboxWebUrl(row.path) : null,
    status: await loadUploadStatus(bookingId),
  };
}
