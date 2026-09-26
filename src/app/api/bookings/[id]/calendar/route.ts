import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bookings, listings, agents, bookingLineItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { formatPhone, formatPrice } from "@/lib/format";

// Used when no shooting hours have been recorded yet.
const DEFAULT_DURATION_HOURS = 2;

// Escapes the characters iCalendar's TEXT value type reserves, per RFC 5545 §3.3.11.
function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// UTC basic format, e.g. 20260924T175000Z — unambiguous regardless of the
// calendar app's own timezone.
function toIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Same plain-<a href> approach as the agent vCard route
// (src/app/api/agents/[id]/vcard/route.ts): iOS recognizes text/calendar
// and shows its native "Add to Calendar" sheet. UID is the booking id, so
// re-saving after a change updates the existing event instead of
// duplicating it in calendars that honor that.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (!booking.jobDate) {
    return NextResponse.json({ error: "Set a job date before adding this booking to a calendar" }, { status: 400 });
  }

  const [linkedListing, contact, lineItems] = await Promise.all([
    booking.listingId
      ? db.select().from(listings).where(eq(listings.id, booking.listingId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    booking.contactAgentId
      ? db
          .select({ name: agents.name, phone: agents.phone })
          .from(agents)
          .where(eq(agents.id, booking.contactAgentId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select({ description: bookingLineItems.description, amount: bookingLineItems.amount })
      .from(bookingLineItems)
      .where(eq(bookingLineItems.bookingId, id)),
  ]);

  const address = linkedListing?.address ?? booking.address;
  const city = linkedListing?.city ?? booking.city;
  const state = linkedListing?.state ?? booking.state;
  const location = [address, city, state].filter(Boolean).join(", ");

  const start = booking.jobDate;
  const durationHours = booking.shootingHours ?? DEFAULT_DURATION_HOURS;
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

  const description = [
    contact?.name || contact?.phone
      ? `Contact: ${[contact.name, formatPhone(contact.phone)].filter(Boolean).join(" · ")}`
      : null,
    booking.lockboxCode ? `Lockbox: ${booking.lockboxCode}` : null,
    ...lineItems.map((li) => `${li.description}: ${formatPrice(li.amount)}`),
    booking.notes ? `\n${booking.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LeadFinder//Bookings//EN",
    "BEGIN:VEVENT",
    `UID:booking-${booking.id}@leadfinder`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(`Shoot — ${address || city || "Booking"}`)}`,
    location ? `LOCATION:${escapeIcsText(location)}` : null,
    description ? `DESCRIPTION:${escapeIcsText(description)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .filter(Boolean)
    .join("\r\n");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="booking-${booking.id.slice(0, 8)}.ics"`,
    },
  });
}
