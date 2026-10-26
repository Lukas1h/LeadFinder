import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { loadInvoiceDetails, type InvoiceDetails } from "@/lib/invoice";
import { notifyPaymentReceived } from "@/lib/push";
import { idempotencyKey, SquareError, squareConfigured, squareFetch, squareLocationId } from "@/lib/square";

// The Square copy of a booking's invoice: same number, same line items, same
// note, with Square's payment page as the client's "Pay Online". Delivered
// SHARE_MANUALLY, so Square never emails or texts anyone; the client only
// gets it through the invoice and gallery Lukas sends.

/** Where Lukas's own email stands in when the agent has none: Square's payment receipt comes to him instead. */
const FALLBACK_EMAIL = "lukas@lukashahn.media";

interface SquareInvoice {
  id: string;
  version: number;
  status: string;
  public_url?: string;
  payment_requests?: { total_completed_amount_money?: { amount?: number } }[];
}

export interface SquareInvoiceState {
  url: string | null;
  paid: boolean;
}

/** YYYY-MM-DD on Lukas's own calendar, not UTC's (an evening invoice would otherwise be dated tomorrow). */
function oregonDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
}

/** What the Square copy is made from; when this changes, the copy is replaced. */
function fingerprint(details: InvoiceDetails, invoiceNumber: number): string {
  const lines = details.lineItems.map((li) => `${li.description}\u0000${li.amount}`).sort();
  return createHash("sha256")
    .update(JSON.stringify([invoiceNumber, lines, details.booking.invoiceNote ?? "", details.addressLine, details.contact?.id ?? null]))
    .digest("hex")
    .slice(0, 32);
}

function e164(phone: string | null): string | undefined {
  const digits = phone?.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
  return digits?.length === 10 ? `+1${digits}` : undefined;
}

/**
 * The agent's own Square customer, found by reference id (agent:<id>, or
 * booking:<id> with no agent attached) so two agents never share one, made
 * the first time they're invoiced.
 */
async function customerFor(details: InvoiceDetails): Promise<string> {
  const referenceId = details.contact ? `agent:${details.contact.id}` : `booking:${details.booking.id}`;
  const found = await squareFetch<{ customers?: { id: string }[] }>("POST", "/v2/customers/search", {
    query: { filter: { reference_id: { exact: referenceId } } },
    limit: 1,
  });
  if (found.customers?.[0]) return found.customers[0].id;

  const name = (details.contact?.name ?? details.billedToName).trim().split(/\s+/);
  const email = details.contact?.email?.includes("@") ? details.contact.email.trim() : FALLBACK_EMAIL;
  const created = await squareFetch<{ customer: { id: string } }>("POST", "/v2/customers", {
    idempotency_key: idempotencyKey("customer", referenceId),
    given_name: name[0] || "Client",
    family_name: name.slice(1).join(" ") || undefined,
    company_name: details.billedToSub ?? undefined,
    email_address: email,
    phone_number: e164(details.contact?.phone ?? null),
    reference_id: referenceId,
  });
  return created.customer.id;
}

async function markPaid(bookingId: string, amountCents: number | undefined, where: string): Promise<void> {
  const [updated] = await db
    .update(bookings)
    .set({ paidAt: new Date() })
    .where(and(eq(bookings.id, bookingId), isNull(bookings.paidAt)))
    .returning({ id: bookings.id });
  if (updated) await notifyPaymentReceived((amountCents ?? 0) / 100, where || "A booking").catch(() => {});
}

/** Called by the Square webhook: an invoice of ours got paid. */
export async function markSquareInvoicePaid(squareInvoiceId: string, amountCents: number | undefined): Promise<boolean> {
  const [booking] = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.squareInvoiceId, squareInvoiceId));
  if (!booking) return false;
  const details = await loadInvoiceDetails(booking.id);
  await markPaid(booking.id, amountCents, details?.addressLine ?? "");
  return true;
}

async function cancel(invoice: SquareInvoice): Promise<void> {
  if (invoice.status === "DRAFT") {
    await squareFetch("DELETE", `/v2/invoices/${invoice.id}?version=${invoice.version}`);
  } else if (invoice.status === "UNPAID" || invoice.status === "SCHEDULED") {
    await squareFetch("POST", `/v2/invoices/${invoice.id}/cancel`, { version: invoice.version });
  }
}

/** A new, published Square invoice matching `details`, numbered `invoiceNumber`. */
async function create(details: InvoiceDetails, invoiceNumber: number, sync: string, replacing: string | null): Promise<SquareInvoice> {
  // Keys tie each request to what it's for and which copy it replaces, so a
  // repeat (two tabs) gets the same objects back but a deliberate remake doesn't.
  const generation = [details.booking.id, sync, replacing ?? "first"];
  const locationId = squareLocationId();
  const customerId = await customerFor(details);
  const { booking } = details;

  const { order } = await squareFetch<{ order: { id: string } }>("POST", "/v2/orders", {
    idempotency_key: idempotencyKey("order", ...generation),
    order: {
      location_id: locationId,
      customer_id: customerId,
      reference_id: booking.id,
      line_items: details.lineItems.map((li) => ({
        name: li.description.slice(0, 512),
        quantity: "1",
        base_price_money: { amount: Math.round(li.amount * 100), currency: "USD" },
      })),
    },
  });

  const invoicedAt = oregonDate(booking.invoicedAt ?? new Date());
  // Exactly the app's number. Only if Square already holds it (a copy that was
  // replaced or cancelled keeps its number) does the new one get a -2, -3…
  for (let rev = 1; rev <= 9; rev++) {
    const number = rev === 1 ? String(invoiceNumber) : `${invoiceNumber}-${rev}`;
    try {
      const { invoice } = await squareFetch<{ invoice: SquareInvoice }>("POST", "/v2/invoices", {
        idempotency_key: idempotencyKey("invoice", ...generation, number),
        invoice: {
          location_id: locationId,
          order_id: order.id,
          primary_recipient: { customer_id: customerId },
          delivery_method: "SHARE_MANUALLY",
          invoice_number: number,
          title: (details.addressLine || "Hahn Media").slice(0, 255),
          description: booking.invoiceNote?.trim() || undefined,
          sale_or_service_date: invoicedAt,
          payment_requests: [{ request_type: "BALANCE", due_date: invoicedAt, tipping_enabled: false }],
          accepted_payment_methods: { card: true, bank_account: true, cash_app_pay: true, square_gift_card: false, buy_now_pay_later: false },
        },
      });
      const { invoice: published } = await squareFetch<{ invoice: SquareInvoice }>("POST", `/v2/invoices/${invoice.id}/publish`, {
        idempotency_key: idempotencyKey("publish", invoice.id),
        version: invoice.version,
      });
      return published;
    } catch (err) {
      const taken = err instanceof SquareError && /invoice.?number|already/i.test(err.message);
      if (!taken) throw err;
    }
  }
  throw new Error(`Square has invoice numbers ${invoiceNumber} through ${invoiceNumber}-9 taken`);
}

/**
 * Makes the booking's Square invoice match its invoice, and returns where to
 * pay it. Runs whenever the invoice is opened (creating it on "Create
 * invoice") and from the booking's "Copy pay link":
 *
 * - none yet: creates and publishes one;
 * - the line items, note, address or agent changed since: cancels the old one
 *   (unless it's already paid) and makes a new one, so nobody pays a stale amount;
 * - paid in Square: records paidAt, in case the webhook hasn't.
 *
 * Does nothing without Square configured, for a booking with no invoice
 * number yet, or (with no Square copy already) for a completed job.
 */
export async function syncSquareInvoice(bookingId: string): Promise<SquareInvoiceState> {
  const details = await loadInvoiceDetails(bookingId);
  if (!details) return { url: null, paid: false };
  const { booking } = details;
  const current: SquareInvoiceState = { url: booking.squareInvoiceUrl, paid: Boolean(booking.paidAt) };
  if (!squareConfigured() || booking.paidAt || booking.invoiceNumber == null) return current;

  let existing: SquareInvoice | null = null;
  if (booking.squareInvoiceId) {
    existing = (await squareFetch<{ invoice: SquareInvoice }>("GET", `/v2/invoices/${booking.squareInvoiceId}`)).invoice;
    if (existing.status === "PAID") {
      await markPaid(booking.id, existing.payment_requests?.[0]?.total_completed_amount_money?.amount, details.addressLine);
      return { url: booking.squareInvoiceUrl, paid: true };
    }
    // Partly paid in Square: leave it alone rather than cancel money already taken.
    if (existing.status === "PARTIALLY_PAID") return current;
  }

  // A completed job was invoiced and settled the old way (check, Venmo…):
  // reopening its invoice to reprint it mustn't start asking for money again.
  if (!existing && booking.completedAt) return current;

  const sync = fingerprint(details, booking.invoiceNumber);
  const live = existing && ["UNPAID", "SCHEDULED", "DRAFT"].includes(existing.status);
  if (live && booking.squareInvoiceSync === sync) return current;

  if (existing && live) await cancel(existing);
  if (details.total <= 0) {
    await db.update(bookings).set({ squareInvoiceId: null, squareInvoiceUrl: null, squareInvoiceSync: null }).where(eq(bookings.id, bookingId));
    return { url: null, paid: false };
  }

  const invoice = await create(details, booking.invoiceNumber, sync, existing?.id ?? null);
  await db
    .update(bookings)
    .set({ squareInvoiceId: invoice.id, squareInvoiceUrl: invoice.public_url ?? null, squareInvoiceSync: sync })
    .where(eq(bookings.id, bookingId));
  return { url: invoice.public_url ?? null, paid: false };
}

/** "Delete invoice": cancels its Square copy too (a paid one is left as the record it is). */
export async function cancelSquareInvoice(bookingId: string): Promise<void> {
  const [booking] = await db.select({ id: bookings.squareInvoiceId }).from(bookings).where(eq(bookings.id, bookingId));
  if (booking?.id && squareConfigured()) {
    const { invoice } = await squareFetch<{ invoice: SquareInvoice }>("GET", `/v2/invoices/${booking.id}`);
    await cancel(invoice);
  }
  await db.update(bookings).set({ squareInvoiceId: null, squareInvoiceUrl: null, squareInvoiceSync: null }).where(eq(bookings.id, bookingId));
}
