import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Square through its REST API rather than the SDK: invoices need a handful of
// calls, not worth a dependency (same reasoning the old Stripe client had).
// SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID are set in Vercel;
// SQUARE_ENVIRONMENT=sandbox points it at Square's sandbox instead.

const VERSION = "2024-03-20";

export function squareConfigured(): boolean {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

export function squareLocationId(): string {
  const id = process.env.SQUARE_LOCATION_ID;
  if (!id) throw new Error("SQUARE_LOCATION_ID is not set");
  return id;
}

function baseUrl(): string {
  return process.env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
}

export class SquareError extends Error {
  constructor(
    message: string,
    readonly codes: string[]
  ) {
    super(message);
  }
}

/** One Square API call; a failure throws with Square's own error detail. */
export async function squareFetch<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error("SQUARE_ACCESS_TOKEN is not set");
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { "Square-Version": VERSION, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { errors?: { code?: string; detail?: string; field?: string }[] };
  if (!res.ok) {
    const errors = json.errors ?? [];
    const detail = errors.map((e) => [e.detail ?? e.code, e.field ? `(${e.field})` : ""].join(" ").trim()).join("; ");
    throw new SquareError(`Square ${method} ${path}: ${detail || res.status}`, errors.map((e) => e.code ?? ""));
  }
  return json as T;
}

/**
 * An idempotency key made from what the request is for, so a retried or
 * doubled request (two tabs opening the same invoice) gets Square's existing
 * object back instead of a second one. 40 hex chars fits every endpoint's limit.
 */
export function idempotencyKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

/**
 * Checks a webhook's x-square-hmacsha256-signature: base64 HMAC-SHA256, keyed
 * with the subscription's signature key, over the notification URL followed
 * by the raw body.
 */
export function verifySquareSignature(notificationUrl: string, body: string, header: string | null): boolean {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !header) return false;
  const expected = createHmac("sha256", key).update(notificationUrl + body).digest();
  const given = Buffer.from(header, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
