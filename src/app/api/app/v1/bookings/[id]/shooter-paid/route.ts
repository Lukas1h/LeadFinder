import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getBookingWithDetails } from "@/app/booked/actions";
import { setShooterPaid } from "@/lib/shooters";
import { bookingJson } from "../../../serialize";
import { badRequest, isUuid, notFound, readJson, withErrors } from "../../../helpers";

/**
 * "Paid <name>": logs the shooter's agreed pay as a Subcontractors expense on
 * the job (or removes it again with `paid: false`). Paying needs a shooter and
 * a positive amount set first — that error comes back as a 400.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);
  if (typeof body.paid !== "boolean") return badRequest("paid must be true or false");

  const result = await setShooterPaid(id, body.paid);
  if (result.error) return badRequest(result.error);

  const fresh = await getBookingWithDetails(id);
  return NextResponse.json({ ok: true, booking: fresh ? bookingJson(fresh) : null });
});
