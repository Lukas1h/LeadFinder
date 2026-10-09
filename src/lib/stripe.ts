import { createHmac, timingSafeEqual } from "crypto";

// Stripe through its REST API rather than the `stripe` package: the app needs
// three calls and a signature check, which isn't worth a dependency.

const API = "https://api.stripe.com/v1";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Flattens {a: {b: 1}} to Stripe's form encoding, a[b]=1. */
function encode(params: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") encode(value as Record<string, unknown>, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function stripePost<T>(path: string, params: Record<string, unknown>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: encode(params),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path}: ${json?.error?.message ?? res.status}`);
  return json as T;
}

/**
 * A Payment Link for one booking's total. Payment Links don't expire, unlike
 * Checkout Sessions, so the gallery can show the same one for as long as the
 * invoice is open. The booking id rides along as metadata, which Stripe copies
 * onto the Checkout Session the webhook receives.
 */
export async function createPaymentLink(input: {
  bookingId: string;
  amountDollars: number;
  description: string;
  redirectUrl: string;
}): Promise<{ id: string; url: string }> {
  const price = await stripePost<{ id: string }>("/prices", {
    currency: "usd",
    unit_amount: Math.round(input.amountDollars * 100),
    product_data: { name: input.description },
  });
  return stripePost<{ id: string; url: string }>("/payment_links", {
    line_items: { 0: { price: price.id, quantity: 1 } },
    metadata: { booking_id: input.bookingId },
    payment_intent_data: { metadata: { booking_id: input.bookingId } },
    after_completion: { type: "redirect", redirect: { url: input.redirectUrl } },
  });
}

/** Stops an old link from taking payments, once it's been replaced or paid. */
export async function deactivatePaymentLink(id: string): Promise<void> {
  await stripePost(`/payment_links/${id}`, { active: false });
}

/**
 * Checks a webhook's Stripe-Signature header against STRIPE_WEBHOOK_SECRET,
 * the same HMAC-SHA256 scheme the stripe package uses, with a 5-minute
 * tolerance against replays.
 */
export function verifyStripeSignature(payload: string, header: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest();
  return signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
