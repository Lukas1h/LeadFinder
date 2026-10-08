import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { reopenBooking } from "@/app/booked/actions";
import { isUuid, notFound, withErrors } from "../../../helpers";

/**
 * Steps a booking back one state (Completed → waiting for payment → in
 * progress), decided by the web's own reopenBooking rather than by anything the
 * app sends, so the two can't disagree about what "back one step" means.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  await reopenBooking(id);
  return NextResponse.json({ ok: true });
});
