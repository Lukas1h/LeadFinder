import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, bookingLineItems, bookings, listings, type Booking } from "@/db/schema";

// Numbering picks up after 105 — 106 itself was the 1353 Dalton Ct /
// Chandra Reynolds job, sent by hand before this feature existed, and is
// meant to be (re)created as this app's very first tracked invoice rather
// than skipped over. See the comment on bookings.invoiceNumber.
const LAST_MANUAL_INVOICE_NUMBER = 105;

/**
 * Assigns a booking its invoice number the first time it's invoiced, then
 * never again — re-opening the same invoice always shows the same number.
 * The write is idempotent: every call after the first is a pure read.
 */
export async function getOrAssignInvoiceNumber(bookingId: string, existing: number | null): Promise<number> {
  if (existing != null) return existing;

  const [{ max }] = await db.select({ max: sql<number | null>`max(${bookings.invoiceNumber})` }).from(bookings);
  const next = (max ?? LAST_MANUAL_INVOICE_NUMBER) + 1;

  await db.update(bookings).set({ invoiceNumber: next, invoicedAt: new Date() }).where(eq(bookings.id, bookingId));
  return next;
}

export interface InvoiceDetails {
  booking: Booking;
  lineItems: { description: string; amount: number }[];
  total: number;
  /** "1353 Dalton Ct, Roseburg, OR" — the invoice's property line. */
  addressLine: string;
  billedToName: string;
  /** The listing's brokerage, under the name. */
  billedToSub: string | null;
  /** The booking's contact agent, for the Square copy's customer. */
  contact: { id: string; name: string | null; email: string | null; phone: string | null } | null;
}

/**
 * Everything an invoice shows, read the same way for the printable invoice
 * (/api/bookings/[id]/invoice) and its Square copy (lib/squareInvoice.ts), so
 * the two can't drift apart.
 */
export async function loadInvoiceDetails(bookingId: string): Promise<InvoiceDetails | null> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) return null;

  const [linkedListing, contact, lineItems] = await Promise.all([
    booking.listingId
      ? db
          .select({ address: listings.address, city: listings.city, state: listings.state, brokerName: listings.brokerName })
          .from(listings)
          .where(eq(listings.id, booking.listingId))
          .then((r) => r[0] ?? null)
      : null,
    booking.contactAgentId
      ? db
          .select({ id: agents.id, name: agents.name, email: agents.email, phone: agents.phone })
          .from(agents)
          .where(eq(agents.id, booking.contactAgentId))
          .then((r) => r[0] ?? null)
      : null,
    db
      .select({ description: bookingLineItems.description, amount: bookingLineItems.amount })
      .from(bookingLineItems)
      .where(eq(bookingLineItems.bookingId, bookingId))
      .orderBy(bookingLineItems.createdAt),
  ]);

  return {
    booking,
    lineItems,
    total: lineItems.reduce((sum, li) => sum + li.amount, 0),
    addressLine: [linkedListing?.address ?? booking.address, linkedListing?.city ?? booking.city, linkedListing?.state ?? booking.state]
      .filter(Boolean)
      .join(", "),
    billedToName: contact?.name ?? "Client",
    billedToSub: linkedListing?.brokerName ?? null,
    contact,
  };
}
