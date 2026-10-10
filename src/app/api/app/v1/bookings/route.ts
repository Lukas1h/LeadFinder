import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { loadBookingsWithDetails, groupBookings } from "@/app/booked/data";
import { createBooking } from "@/app/booked/actions";
import { bookingJson } from "../serialize";
import { badRequest, lineItemList, optionalDate, optionalString, readJson, withErrors } from "../helpers";

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

/**
 * Book a job that isn't tied to a tracked listing (a cold call, a referral):
 * the web's "Add booking" through `createBooking`, so the contact agent is
 * found or created by phone and the relationship bump happens as it does there.
 * A city is required when there's no listing, which the action enforces.
 */
export const POST = withErrors(async (req: Request) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const body = await readJson(req);
  const result = await createBooking({
    listingId: null,
    address: optionalString(body.address, "address"),
    city: optionalString(body.city, "city"),
    state: optionalString(body.state, "state"),
    contactName: optionalString(body.contactName, "contactName") ?? "",
    contactPhone: optionalString(body.contactPhone, "contactPhone") ?? "",
    jobDate: optionalDate(body.jobDate, "jobDate"),
    lockboxCode: optionalString(body.lockboxCode, "lockboxCode"),
    notes: optionalString(body.notes, "notes"),
    invoiceNote: optionalString(body.invoiceNote, "invoiceNote"),
    lineItems: body.lineItems === undefined ? [] : lineItemList(body.lineItems, "lineItems"),
  });
  if (result.error) return badRequest(result.error);

  return NextResponse.json({ ok: true });
});
