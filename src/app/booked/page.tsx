import { Suspense } from "react";
import { db } from "@/db";
import { bookings, listings, agents, bookingLineItems } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { estimateDriveTime } from "@/lib/driveTime";
import { BookedList, type BookingWithDetails } from "./BookedList";
import { BookedSkeleton } from "./loading";

export default function BookedPage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<BookedSkeleton />}>
        <BookedContent />
      </Suspense>
    </main>
  );
}

async function BookedContent() {
  // Cached — see the matching comment in src/app/pipeline/page.tsx. Every
  // mutation in src/app/booked/actions.ts calls revalidatePath("/booked").
  "use cache";

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
      ? db.select({ id: agents.id, name: agents.name, phone: agents.phone }).from(agents).where(inArray(agents.id, agentIds))
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

  const withDetails: BookingWithDetails[] = rows.map((b) => {
    const linkedListing = b.listingId ? listingById.get(b.listingId) : undefined;
    const contact = b.contactAgentId ? contactById.get(b.contactAgentId) : undefined;
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
      contactName: contact?.name ?? null,
      contactPhone: contact?.phone ?? null,
      lineItems: lineItemsByBookingId.get(b.id) ?? [],
      driveTime: city ? estimateDriveTime(city) : null,
    };
  });

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Booked</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {withDetails.length} job{withDetails.length === 1 ? "" : "s"} on the books
        </p>
      </header>

      <BookedList bookings={withDetails} />
    </>
  );
}
