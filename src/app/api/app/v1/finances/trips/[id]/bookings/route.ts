import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings, trips } from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { linkBookingToTrip } from "@/lib/finance/writes";
import { isUuid, notFound, readJson, requiredString, badRequest, withErrors } from "../../../../helpers";

/** `{ bookingId }`: adds a job to a trip already logged, like the second job of a two-job day. */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const bookingId = requiredString((await readJson(req)).bookingId, "bookingId");
  if (!isUuid(bookingId)) return badRequest("bookingId must be an id");
  const [trip] = await db.select({ id: trips.id }).from(trips).where(eq(trips.id, id));
  const [booking] = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bookingId));
  if (!trip || !booking) return notFound();
  await linkBookingToTrip(id, bookingId);
  return NextResponse.json({ ok: true });
});
