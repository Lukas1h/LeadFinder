import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { deleteBooking, getBookingWithDetails, getGalleryActivity, updateBooking } from "@/app/booked/actions";
import { bookingJson } from "../../serialize";
import {
  badRequest,
  isUuid,
  lineItemList,
  notFound,
  optionalDate,
  optionalNumber,
  optionalString,
  readJson,
  withErrors,
} from "../../helpers";

/** One booking plus the client gallery's open/download log. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const booking = await getBookingWithDetails(id);
  if (!booking) return notFound();

  return NextResponse.json({ booking: bookingJson(booking), galleryActivity: await getGalleryActivity(id) });
}

/**
 * Edit a booking in place — the web's booking edit form, through the same
 * `updateBooking`. Every field is optional and anything left out keeps its
 * current value (the action itself replaces everything, so this fills the gaps
 * from the stored booking first). A blank string clears a text field; sending
 * `lineItems` replaces them all, as the web does.
 *
 * Note the contact is matched by phone: sending a name with no phone drops the
 * contact link, exactly as it does on the web.
 */
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const current = await getBookingWithDetails(id);
  if (!current) return notFound();

  const body = await readJson(req);
  const text = (field: string, existing: string | null | undefined) =>
    body[field] === undefined ? (existing ?? "") : (optionalString(body[field], field) ?? "");
  const hours = (field: string, existing: number | null) =>
    body[field] === undefined ? existing : optionalNumber(body[field], field);

  const result = await updateBooking(id, {
    address: text("address", current.address),
    city: text("city", current.city),
    state: text("state", current.state),
    contactName: text("contactName", current.contactName),
    contactPhone: text("contactPhone", current.contactPhone),
    jobDate: body.jobDate === undefined ? current.jobDate : optionalDate(body.jobDate, "jobDate"),
    lockboxCode: text("lockboxCode", current.lockboxCode),
    notes: text("notes", current.notes),
    invoiceNote: text("invoiceNote", current.invoiceNote),
    lineItems:
      body.lineItems === undefined
        ? current.lineItems.map((li) => ({ description: li.description, amount: li.amount }))
        : lineItemList(body.lineItems, "lineItems"),
    dropboxFolderLink: text("dropboxFolderLink", current.dropboxFolderLink),
    completion: {
      driveHours: hours("driveHours", current.driveHours),
      editingHours: hours("editingHours", current.editingHours),
      shootingHours: hours("shootingHours", current.shootingHours),
      logisticsHours: hours("logisticsHours", current.logisticsHours),
      additionalCosts: hours("additionalCosts", current.additionalCosts),
    },
  });
  if (result.error) return badRequest(result.error);

  const fresh = await getBookingWithDetails(id);
  return NextResponse.json({ ok: true, booking: fresh ? bookingJson(fresh) : null });
});

/**
 * Cancel a booking: deletes it and its line items. If it was the listing's
 * current booking, the listing goes back to "saved" — the web's deleteBooking.
 */
export const DELETE = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  await deleteBooking(id);
  return NextResponse.json({ ok: true });
});
