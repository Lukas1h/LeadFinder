"use server";

import { db } from "@/db";
import { bookings, bookingLineItems, listings, agents, type NewBookingLineItem } from "@/db/schema";
import { eq, inArray, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { bumpAgentRelationshipOnMilestone, resolveSendOutcome } from "@/app/actions";
import { estimateDriveTime } from "@/lib/driveTime";
import type { BookingWithDetails } from "./BookedList";

export interface BookingLineItemInput {
  description: string;
  amount: number;
}

export interface CreateBookingInput {
  // Set when booking an existing lead (from the pipeline or a listing's
  // detail modal); omitted for a job typed in from a cold call, where
  // address/city/state below are the only record of where it is.
  listingId?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  contactName: string;
  contactPhone: string;
  jobDate: Date | null;
  lockboxCode: string | null;
  notes: string | null;
  lineItems: BookingLineItemInput[];
}

export interface CreateBookingResult {
  error?: string;
}

// Same editable fields as creation, minus listingId — a booking's linked
// property doesn't change after the fact; reshoot the same listing by
// creating a new booking instead (see createBooking's doc comment).
// address/city/state only matter for a booking with no linked listing —
// harmless to send/store them otherwise, since display always prefers the
// linked listing's own fields (see page.tsx).
export interface UpdateBookingInput {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  contactName: string;
  contactPhone: string;
  jobDate: Date | null;
  lockboxCode: string | null;
  notes: string | null;
  lineItems: BookingLineItemInput[];
}

/**
 * Looks up an existing agent by phone, or creates a bare one — distinct
 * from touchAgentContact (src/app/actions.ts), which is specifically for
 * "we just contacted this agent about a listing" and always overwrites
 * lastContactedAt/name on conflict. A booking's contact shouldn't clobber
 * an existing agent's info just because Lukas retyped their name slightly
 * differently while filling out the form.
 */
async function findOrCreateAgentByPhone(phone: string, name: string): Promise<string | null> {
  const trimmedPhone = phone.trim();
  if (!trimmedPhone) return null;

  const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.phone, trimmedPhone));
  if (existing) return existing.id;

  const [row] = await db
    .insert(agents)
    .values({ phone: trimmedPhone, name: name.trim() || null })
    .returning({ id: agents.id });
  return row?.id ?? null;
}

/**
 * Creates a booking (+ its line items), and if it's tied to a listing,
 * marks that listing booked and points its bookingId here — the single
 * entry point for both "Mark booked" on a lead and a standalone cold-call
 * booking with no listing at all. Reuses the same agent-relationship-bump
 * and send-outcome-attribution side effects updateListingStatus already
 * does for other transitions, since this replaces that path for "booked."
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  if (!input.listingId && !input.city?.trim()) {
    return { error: "Enter at least a city for a booking with no linked listing" };
  }

  const contactAgentId =
    input.contactName.trim() || input.contactPhone.trim()
      ? await findOrCreateAgentByPhone(input.contactPhone, input.contactName)
      : null;

  const [booking] = await db
    .insert(bookings)
    .values({
      listingId: input.listingId ?? null,
      address: input.listingId ? null : input.address?.trim() || null,
      city: input.listingId ? null : input.city?.trim() || null,
      state: input.listingId ? null : input.state?.trim() || null,
      contactAgentId,
      jobDate: input.jobDate,
      lockboxCode: input.lockboxCode?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .returning({ id: bookings.id });

  if (!booking) return { error: "Couldn't create the booking — try again." };

  const validLineItems: NewBookingLineItem[] = input.lineItems
    .filter((li) => li.description.trim() && li.amount > 0)
    .map((li) => ({ bookingId: booking.id, description: li.description.trim(), amount: li.amount }));
  if (validLineItems.length > 0) {
    await db.insert(bookingLineItems).values(validLineItems);
  }

  // Booking someone is itself a relationship milestone — bump it whenever
  // there's a contact, not just when the booking happens to be tied to a
  // listing (a cold-call booking with no listing still books a real agent).
  if (contactAgentId) {
    await bumpAgentRelationshipOnMilestone(input.contactPhone.trim() || null, input.contactName.trim() || null, "booked");
  }

  if (input.listingId) {
    const now = new Date();
    await db
      .update(listings)
      .set({ status: "booked", statusChangedAt: now, bookingId: booking.id })
      .where(eq(listings.id, input.listingId));
    await resolveSendOutcome(input.listingId, "booked");
  }

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/booked");
  revalidatePath("/messaging");
  revalidatePath("/agents");

  return {};
}

/**
 * Edits an existing booking in place — the "click a booking card" flow.
 * Line items are fully replaced rather than diffed against the form's
 * local rows, same reasoning as createBooking: far simpler than tracking
 * which rows are new/edited/removed, and a booking has few enough line
 * items that this is cheap.
 */
export async function updateBooking(bookingId: string, input: UpdateBookingInput): Promise<CreateBookingResult> {
  const contactAgentId =
    input.contactName.trim() || input.contactPhone.trim()
      ? await findOrCreateAgentByPhone(input.contactPhone, input.contactName)
      : null;

  await db
    .update(bookings)
    .set({
      address: input.address?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      contactAgentId,
      jobDate: input.jobDate,
      lockboxCode: input.lockboxCode?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .where(eq(bookings.id, bookingId));

  await db.delete(bookingLineItems).where(eq(bookingLineItems.bookingId, bookingId));
  const validLineItems: NewBookingLineItem[] = input.lineItems
    .filter((li) => li.description.trim() && li.amount > 0)
    .map((li) => ({ bookingId, description: li.description.trim(), amount: li.amount }));
  if (validLineItems.length > 0) {
    await db.insert(bookingLineItems).values(validLineItems);
  }

  revalidatePath("/booked");
  revalidatePath("/pipeline");
  revalidatePath("/messaging");
  revalidatePath("/agents");

  return {};
}

/**
 * Single-booking fetch with the same joined shape page.tsx builds in bulk
 * for the /booked list — used to lazily load a booking's details for the
 * little reference card on a listing's detail modal (BookingRow), so that
 * card doesn't need every listing page load to eagerly join bookings.
 */
export async function getBookingWithDetails(bookingId: string): Promise<BookingWithDetails | null> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) return null;

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
      .where(eq(bookingLineItems.bookingId, bookingId)),
  ]);

  const city = linkedListing?.city ?? booking.city;
  const state = linkedListing?.state ?? booking.state;

  return {
    id: booking.id,
    listingId: booking.listingId,
    address: linkedListing?.address ?? booking.address,
    city,
    state,
    listing: linkedListing,
    jobDate: booking.jobDate,
    lockboxCode: booking.lockboxCode,
    notes: booking.notes,
    completedAt: booking.completedAt,
    createdAt: booking.createdAt,
    contactName: contact?.name ?? null,
    contactPhone: contact?.phone ?? null,
    lineItems,
    driveTime: city ? estimateDriveTime(city) : null,
  };
}

/**
 * Every booking this agent has been the contact on, newest first — powers
 * the "Bookings" section (and count) on AgentDetailDialog, same joined
 * shape as getBookingWithDetails but for the whole set at once instead of
 * one bookingId. contactName/contactPhone are just this agent's own info,
 * fetched once rather than per row.
 */
export async function getAgentBookings(agentId: string): Promise<BookingWithDetails[]> {
  const rows = await db
    .select()
    .from(bookings)
    .where(eq(bookings.contactAgentId, agentId))
    .orderBy(desc(bookings.createdAt));
  if (rows.length === 0) return [];

  const listingIds = [...new Set(rows.map((b) => b.listingId).filter((id): id is string => id != null))];
  const bookingIds = rows.map((b) => b.id);

  const [linkedListings, lineItems, [agent]] = await Promise.all([
    listingIds.length > 0
      ? db.select().from(listings).where(inArray(listings.id, listingIds))
      : Promise.resolve([]),
    db
      .select({
        bookingId: bookingLineItems.bookingId,
        description: bookingLineItems.description,
        amount: bookingLineItems.amount,
      })
      .from(bookingLineItems)
      .where(inArray(bookingLineItems.bookingId, bookingIds)),
    db.select({ name: agents.name, phone: agents.phone }).from(agents).where(eq(agents.id, agentId)),
  ]);

  const listingById = new Map(linkedListings.map((l) => [l.id, l]));
  const lineItemsByBookingId = new Map<string, { description: string; amount: number }[]>();
  for (const item of lineItems) {
    const list = lineItemsByBookingId.get(item.bookingId) ?? [];
    list.push({ description: item.description, amount: item.amount });
    lineItemsByBookingId.set(item.bookingId, list);
  }

  return rows.map((b) => {
    const linkedListing = b.listingId ? listingById.get(b.listingId) : undefined;
    const city = linkedListing?.city ?? b.city;
    const state = linkedListing?.state ?? b.state;
    return {
      id: b.id,
      listingId: b.listingId,
      address: linkedListing?.address ?? b.address,
      city,
      state,
      listing: linkedListing ?? null,
      jobDate: b.jobDate,
      lockboxCode: b.lockboxCode,
      notes: b.notes,
      completedAt: b.completedAt,
      createdAt: b.createdAt,
      contactName: agent?.name ?? null,
      contactPhone: agent?.phone ?? null,
      driveTime: city ? estimateDriveTime(city) : null,
      lineItems: lineItemsByBookingId.get(b.id) ?? [],
    };
  });
}

export async function markBookingCompleted(bookingId: string) {
  await db.update(bookings).set({ completedAt: new Date() }).where(eq(bookings.id, bookingId));
  revalidatePath("/booked");
  revalidatePath("/agents");
}

export async function reopenBooking(bookingId: string) {
  await db.update(bookings).set({ completedAt: null }).where(eq(bookings.id, bookingId));
  revalidatePath("/booked");
  revalidatePath("/agents");
}

/**
 * Cancels a booking outright — deletes it (its line items cascade). If it
 * was the listing's current booking, clears that pointer so nothing
 * references a deleted row, and if the listing's status was still
 * "booked", reverts it to "saved" (same target PipelineActions' "Reopen"
 * uses) — not "new", which is reserved for brand-new leads Lukas hasn't
 * looked at yet, not ones he's already worked all the way to booked.
 * Leaves the status alone if it had already moved on (e.g. Lukas
 * reopened/requoted it himself since booking) — deleting the booking
 * shouldn't silently override work done after it.
 */
export async function deleteBooking(bookingId: string) {
  const [booking] = await db.select({ listingId: bookings.listingId }).from(bookings).where(eq(bookings.id, bookingId));

  // Must clear the listing's bookingId pointer (if any) before deleting the
  // booking row it references — listings.booking_id has no ON DELETE
  // clause, so deleting first trips the FK constraint.
  if (booking?.listingId) {
    const [listing] = await db
      .select({ status: listings.status, bookingId: listings.bookingId })
      .from(listings)
      .where(eq(listings.id, booking.listingId));

    if (listing?.bookingId === bookingId) {
      await db
        .update(listings)
        .set({
          bookingId: null,
          ...(listing.status === "booked" ? { status: "saved", statusChangedAt: new Date() } : {}),
        })
        .where(eq(listings.id, booking.listingId));
    }
  }

  await db.delete(bookings).where(eq(bookings.id, bookingId));

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/booked");
  revalidatePath("/messaging");
  revalidatePath("/agents");
}
