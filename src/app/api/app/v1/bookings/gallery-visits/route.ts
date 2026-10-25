import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, bookings, galleryViews } from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { parseUserAgent } from "@/lib/galleryViews";

const SHOWN = 40;

/**
 * Home's Bookings card: the newest client-gallery events across every job
 * (the same log as a booking's detail, src/app/booked/actions.ts
 * getGalleryActivity): opens, downloads, invoice views and staging requests.
 * Link-preview fetchers (iMessage, Slack...) log an open before anyone taps,
 * so they are left out: this is about people. Newest first.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  // Over-fetch, since the previews get dropped after parsing the user agent.
  const rows = await db
    .select({
      id: galleryViews.id,
      bookingId: galleryViews.bookingId,
      event: galleryViews.event,
      detail: galleryViews.detail,
      at: galleryViews.at,
      city: galleryViews.city,
      region: galleryViews.region,
      country: galleryViews.country,
      userAgent: galleryViews.userAgent,
      address: bookings.address,
      bookingCity: bookings.city,
      contactName: agents.name,
    })
    .from(galleryViews)
    .innerJoin(bookings, eq(bookings.id, galleryViews.bookingId))
    .leftJoin(agents, eq(agents.id, bookings.contactAgentId))
    .orderBy(desc(galleryViews.at))
    .limit(SHOWN * 3);

  const visits = rows
    .map((r) => ({ r, ua: parseUserAgent(r.userAgent) }))
    .filter(({ ua }) => !ua.isPreview)
    .slice(0, SHOWN)
    .map(({ r, ua }) => ({
      id: r.id,
      bookingId: r.bookingId,
      address: r.address ?? r.bookingCity,
      contactName: r.contactName,
      event: r.event,
      detail: r.detail,
      at: r.at,
      location: [r.city, r.region, r.country && r.country !== "US" ? r.country : null].filter(Boolean).join(", ") || null,
      device: ua.device,
      browser: ua.browser,
    }));

  return NextResponse.json({ visits });
}
