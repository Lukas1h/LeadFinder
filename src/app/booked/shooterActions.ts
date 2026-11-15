"use server";

/**
 * The Booked page's shooter actions — thin wrappers around lib/shooters, which
 * owns the writes (and their revalidation) so the phone API and the MCP tools
 * log a payment exactly the way the web does.
 */

import { listShooters, setBookingShooter, setShooterPaid } from "@/lib/shooters";
import { getOrCreateBookingUploadLink } from "@/lib/mediaUploads";

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
