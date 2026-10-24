import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/db";
import { bookings, listings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listGalleryMedia } from "@/lib/dropbox";
import { recordGalleryEvent } from "@/lib/galleryViews";
import { notifyStagingRequest } from "@/lib/push";

const MAX_NOTE = 1000;

/**
 * A client picking photos on their gallery to be virtually staged. Lukas
 * stages them himself outside the app — this just records which ones (in
 * the booking's gallery activity) and pings him.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await req.json().catch(() => null)) as { names?: unknown; note?: unknown } | null;
  const names = Array.isArray(body?.names) ? body.names.filter((n): n is string => typeof n === "string") : [];
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, MAX_NOTE) : "";
  if (names.length === 0) return NextResponse.json({ error: "Pick at least one photo" }, { status: 400 });

  const [booking] = await db
    .select({ id: bookings.id, address: bookings.address, listingId: bookings.listingId, dropboxFolderLink: bookings.dropboxFolderLink })
    .from(bookings)
    .where(eq(bookings.galleryToken, token));
  if (!booking?.dropboxFolderLink) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only names this gallery actually has.
  const { photos } = await listGalleryMedia(booking.dropboxFolderLink);
  const valid = new Set(photos.map((p) => p.name));
  const picked = [...new Set(names)].filter((n) => valid.has(n));
  if (picked.length === 0) return NextResponse.json({ error: "Pick at least one photo" }, { status: 400 });

  const [listing] = booking.listingId
    ? await db.select({ address: listings.address }).from(listings).where(eq(listings.id, booking.listingId))
    : [];
  const address = listing?.address ?? booking.address;

  const detail = `${picked.join(", ")}${note ? ` — “${note}”` : ""}`;
  const requestHeaders = new Headers(req.headers);
  after(async () => {
    await recordGalleryEvent(booking.id, "staging_request", requestHeaders, detail);
    await notifyStagingRequest(address, picked.length, note);
  });
  return NextResponse.json({ ok: true, count: picked.length });
}
