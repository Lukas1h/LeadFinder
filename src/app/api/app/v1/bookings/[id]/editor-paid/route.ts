import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getBookingWithDetails } from "@/app/booked/actions";
import { setEditorPaid } from "@/lib/shooters";
import { getMarkets } from "@/lib/marketsData";
import { bookingJson } from "../../../serialize";
import { badRequest, isUuid, notFound, readJson, withErrors } from "../../../helpers";

/**
 * "Paid" for the photo editor, like shooter-paid: logs the editor's cost as a Subcontractors expense on
 * the job (or removes it again with `paid: false`). Paying needs
 * a cost above $0 (recorded, or the HDR default) — else a 400.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);
  if (typeof body.paid !== "boolean") return badRequest("paid must be true or false");

  const result = await setEditorPaid(id, body.paid);
  if (result.error) return badRequest(result.error);

  const [fresh, mk] = await Promise.all([getBookingWithDetails(id), getMarkets()]);
  return NextResponse.json({ ok: true, booking: fresh ? bookingJson(fresh, mk) : null });
});
