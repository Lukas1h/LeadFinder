import { db } from "@/db";
import { bookings, listings, agents, bookingLineItems } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { estimateDriveTime } from "@/lib/driveTime";
import type { BookingWithDetails } from "./BookedList";

/**
 * The Booked page's data, as data.
 *
 * Lifted out of page.tsx so the iPhone app's GET /bookings gets the identical
 * join — and so the "upcoming / editing / invoice sent / completed" split exists
 * once, as a plain function both the list component and the API call, rather
 * than as a useMemo the client can only run for itself.
 */

/** Every booking with its linked listing, contact agent and line items. */
export async function loadBookingsWithDetails(): Promise<BookingWithDetails[]> {
  const rows = await db.select().from(bookings);

  const listingIds = [...new Set(rows.map((b) => b.listingId).filter((id): id is string => id != null))];
  const agentIds = [...new Set(rows.map((b) => b.contactAgentId).filter((id): id is string => id != null))];
  const bookingIds = rows.map((b) => b.id);

  const [linkedListings, contacts, lineItems] = await Promise.all([
    // Full rows, not a curated projection — the "view linked listing"
    // reference card (ListingRow) needs the whole thing: photo, price,
    // status, everything ListingModal shows when it's opened from there.
    listingIds.length > 0
      ? db.select().from(listings).where(inArray(listings.id, listingIds))
      : Promise.resolve([]),
    agentIds.length > 0
      ? db
          .select({ id: agents.id, name: agents.name, phone: agents.phone, lastContactedAt: agents.lastContactedAt })
          .from(agents)
          .where(inArray(agents.id, agentIds))
      : Promise.resolve([]),
    bookingIds.length > 0
      ? db
          .select({
            bookingId: bookingLineItems.bookingId,
            description: bookingLineItems.description,
            amount: bookingLineItems.amount,
          })
          .from(bookingLineItems)
          .where(inArray(bookingLineItems.bookingId, bookingIds))
      : Promise.resolve([]),
  ]);

  const listingById = new Map(linkedListings.map((l) => [l.id, l]));
  const contactById = new Map(contacts.map((a) => [a.id, a]));
  const lineItemsByBookingId = new Map<string, { description: string; amount: number }[]>();
  for (const item of lineItems) {
    const list = lineItemsByBookingId.get(item.bookingId) ?? [];
    list.push({ description: item.description, amount: item.amount });
    lineItemsByBookingId.set(item.bookingId, list);
  }

  return rows.map((b) => {
    const linkedListing = b.listingId ? listingById.get(b.listingId) : undefined;
    const contact = b.contactAgentId ? contactById.get(b.contactAgentId) : undefined;
    const city = linkedListing?.city ?? b.city;
    const state = linkedListing?.state ?? b.state;
    return {
      id: b.id,
      listingId: b.listingId,
      // The agents row this booking's contact is, so the app can jump from a
      // booking straight to the agent — the web reads it off the card's own
      // dialog instead.
      contactAgentId: b.contactAgentId,
      address: linkedListing?.address ?? b.address,
      city,
      state,
      listing: linkedListing ?? null,
      jobDate: b.jobDate,
      dateTentative: b.dateTentative,
      lockboxCode: b.lockboxCode,
      notes: b.notes,
      invoiceNote: b.invoiceNote,
      completedAt: b.completedAt,
      shotAt: b.shotAt,
      invoiceSentAt: b.invoiceSentAt,
      driveHours: b.driveHours,
      editingHours: b.editingHours,
      shootingHours: b.shootingHours,
      logisticsHours: b.logisticsHours,
      additionalCosts: b.additionalCosts,
      createdAt: b.createdAt,
      contactName: contact?.name ?? null,
      contactPhone: contact?.phone ?? null,
      contactLastContactedAt: contact?.lastContactedAt ?? null,
      lineItems: lineItemsByBookingId.get(b.id) ?? [],
      driveTime: city ? estimateDriveTime(city) : null,
      invoiceNumber: b.invoiceNumber,
      invoicedAt: b.invoicedAt,
      dropboxFolderLink: b.dropboxFolderLink,
      galleryToken: b.galleryToken,
      paymentLinkUrl: b.paymentLinkUrl,
      paymentLinkAmount: b.paymentLinkAmount,
      paidAt: b.paidAt,
    };
  });
}

export interface GroupedBookings {
  /** Not shot yet. Includes the tentative ones: the iPhone app reads this list as "everything still to shoot". */
  upcoming: BookingWithDetails[];
  /** The part of `upcoming` whose date isn't settled, longest since he was last in touch first: the one to chase is on top. */
  tentative: BookingWithDetails[];
  /** Shot, no invoice out yet: the photos are still being edited. Longest-waiting first. */
  editing: BookingWithDetails[];
  /** Invoice sent, not yet paid — longest-waiting first, so the one to chase is on top. */
  waiting: BookingWithDetails[];
  completed: BookingWithDetails[];
}

/**
 * The split BookedList renders, as a plain function so the API can
 * return the same buckets instead of re-deciding what "waiting" means.
 */
export function groupBookings(bookings: BookingWithDetails[]): GroupedBookings {
  const upcoming = bookings
    .filter((b) => !b.completedAt && !b.invoiceSentAt && !b.shotAt)
    .sort((a, b) => {
      // No job date yet sinks to the bottom rather than sorting first.
      if (!a.jobDate && !b.jobDate) return b.createdAt.getTime() - a.createdAt.getTime();
      if (!a.jobDate) return 1;
      if (!b.jobDate) return -1;
      return a.jobDate.getTime() - b.jobDate.getTime();
    });
  const editing = bookings
    .filter((b) => !b.completedAt && !b.invoiceSentAt && b.shotAt)
    .sort((a, b) => a.shotAt!.getTime() - b.shotAt!.getTime());
  const waiting = bookings
    .filter((b) => !b.completedAt && b.invoiceSentAt)
    .sort((a, b) => a.invoiceSentAt!.getTime() - b.invoiceSentAt!.getTime());
  const completed = bookings
    .filter((b) => b.completedAt)
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());
  const lastTouch = (b: BookingWithDetails) => (b.contactLastContactedAt ?? b.createdAt).getTime();
  const tentative = upcoming.filter((b) => b.dateTentative).sort((a, b) => lastTouch(a) - lastTouch(b));
  return { upcoming, tentative, editing, waiting, completed };
}
