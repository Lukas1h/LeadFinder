import { revalidatePath } from "next/cache";
import { verifySquareSignature } from "@/lib/square";
import { markSquareInvoicePaid } from "@/lib/squareInvoice";

// Square signs each notification over the subscription's own URL, so it has
// to be exactly what's registered in Square's dashboard.
const NOTIFICATION_URL = process.env.SQUARE_WEBHOOK_URL ?? "https://realestate.lukashahn.art/api/webhooks/square";

interface InvoiceEvent {
  type: string;
  data?: {
    object?: {
      invoice?: {
        id: string;
        status?: string;
        payment_requests?: { total_completed_amount_money?: { amount?: number } }[];
      };
    };
  };
}

/**
 * Square's invoice webhook (subscribe to invoice.payment_made): records the
 * payment on the booking and pushes Lukas a "Paid online". Opening the
 * invoice also picks a payment up (lib/squareInvoice.ts), so this is the
 * instant notice, not the only record.
 */
export async function POST(req: Request) {
  const body = await req.text();
  if (!verifySquareSignature(NOTIFICATION_URL, body, req.headers.get("x-square-hmacsha256-signature"))) {
    return new Response("bad signature", { status: 400 });
  }

  const event = JSON.parse(body) as InvoiceEvent;
  const invoice = event.data?.object?.invoice;
  if (!event.type.startsWith("invoice.") || !invoice || invoice.status !== "PAID") {
    return Response.json({ ignored: event.type });
  }

  const matched = await markSquareInvoicePaid(invoice.id, invoice.payment_requests?.[0]?.total_completed_amount_money?.amount);
  if (matched) revalidatePath("/booked");
  return Response.json({ ok: true, matched });
}
