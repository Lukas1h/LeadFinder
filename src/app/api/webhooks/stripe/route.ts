import { db } from "@/db";
import { bookings } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { deactivatePaymentLink, verifyStripeSignature } from "@/lib/stripe";
import { notifyPaymentReceived } from "@/lib/push";
import { getBookingWithDetails } from "@/app/booked/actions";

// Stripe calls this when a client pays through a booking's payment link (see
// getOrCreatePaymentLink). Card payments arrive as checkout.session.completed
// with payment_status "paid"; bank payments complete later, as
// checkout.session.async_payment_succeeded.
interface CheckoutSession {
  id: string;
  payment_status?: string;
  payment_link?: string | null;
  amount_total?: number | null;
  metadata?: Record<string, string> | null;
}

export async function POST(req: Request) {
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"))) {
    return new Response("bad signature", { status: 400 });
  }

  const event = JSON.parse(payload) as { type: string; data: { object: CheckoutSession } };
  const paidNow =
    (event.type === "checkout.session.completed" && event.data.object.payment_status === "paid") ||
    event.type === "checkout.session.async_payment_succeeded";
  if (!paidNow) return Response.json({ ignored: event.type });

  const session = event.data.object;
  const bookingId = session.metadata?.booking_id;
  const match = bookingId
    ? eq(bookings.id, bookingId)
    : session.payment_link
      ? eq(bookings.stripePaymentLinkId, session.payment_link)
      : null;
  if (!match) return Response.json({ ignored: "no booking" });

  // isNull(paidAt) makes Stripe's retries no-ops.
  const [booking] = await db
    .update(bookings)
    .set({ paidAt: new Date(), stripeCheckoutSessionId: session.id })
    .where(and(match, isNull(bookings.paidAt)))
    .returning({ id: bookings.id, linkId: bookings.stripePaymentLinkId });
  if (!booking) return Response.json({ ok: true, duplicate: true });

  if (booking.linkId) await deactivatePaymentLink(booking.linkId).catch(() => {});
  revalidatePath("/booked");
  // Listing-linked bookings keep their address on the listing.
  const details = await getBookingWithDetails(booking.id);
  await notifyPaymentReceived(
    (session.amount_total ?? 0) / 100,
    [details?.address, details?.city].filter(Boolean).join(", ") || "A booking"
  ).catch(() => {});
  return Response.json({ ok: true });
}
