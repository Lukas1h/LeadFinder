import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { markBookingShot } from "@/app/booked/actions";
import { isUuid, notFound, withErrors } from "../../../helpers";

/** Shot, photos still being edited: moves the booking into "Editing" until the invoice goes out. */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  await markBookingShot(id);
  return NextResponse.json({ ok: true });
});
