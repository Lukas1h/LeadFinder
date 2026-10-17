import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { recheckBookingAirspace } from "@/app/booked/actions";
import { isUuid, notFound, withErrors } from "../../../helpers";

/**
 * "Check again" on a booking's drone airspace, the phone's stand-in for the
 * web's `recheckBookingAirspace` (src/app/booked/actions.ts). Forced, so it runs
 * even when the address hasn't changed: an airport can start or stop offering
 * LAANC, and the facility map's ceiling can be revised.
 *
 * Answers the same `{ summary }` / `{ error }` as the web's action and always
 * 200 — a lookup that found nothing is an answer, not a malformed request, so
 * the app shows the message instead of a server error.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  return NextResponse.json(await recheckBookingAirspace(id));
});