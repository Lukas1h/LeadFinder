import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getBookingWithDetails, getGalleryActivity } from "@/app/booked/actions";
import { bookingJson } from "../../serialize";
import { isUuid, notFound } from "../../helpers";

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
