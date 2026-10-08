import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { loadBookingsWithDetails, groupBookings } from "@/app/booked/data";
import { bookingJson } from "../serialize";

/**
 * Every booking, already split the way the Booked page splits them.
 * "waitingForPayment" is the app's name for the page's "Invoice sent"
 * section — an invoice is out but it hasn't been paid yet.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { upcoming, waiting, completed } = groupBookings(await loadBookingsWithDetails());

  return NextResponse.json({
    upcoming: upcoming.map(bookingJson),
    waitingForPayment: waiting.map(bookingJson),
    completed: completed.map(bookingJson),
  });
}
