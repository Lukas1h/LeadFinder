import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { markInvoiceSent } from "@/app/booked/actions";
import { isUuid, notFound, withErrors } from "../../../helpers";

/** Moves a booking into "Invoice sent" — not completed until it's paid. */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  await markInvoiceSent(id);
  return NextResponse.json({ ok: true });
});
