import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tripBookings, trips } from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { removeTrip, writeTrip } from "@/lib/finance/writes";
import { badRequest, isUuid, notFound, readJson, withErrors } from "../../../helpers";
import { parseTripInput } from "../../shared";

/**
 * Change any of the trip's fields; the ones not sent stay. `bookingIds`, when
 * sent, replaces the linked jobs.
 */
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [current] = await db.select().from(trips).where(eq(trips.id, id));
  if (!current) return notFound();
  const links = await db.select({ bookingId: tripBookings.bookingId }).from(tripBookings).where(eq(tripBookings.tripId, id));
  const result = await writeTrip(id, parseTripInput(await readJson(req), { ...current, bookingIds: links.map((l) => l.bookingId) }));
  if (result.error) return badRequest(result.error);
  return NextResponse.json({ ok: true, id });
});

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  await removeTrip(id);
  return NextResponse.json({ ok: true });
}
