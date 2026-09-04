import { Webhook } from "svix";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { fetchFullListing } from "@/lib/zillapi";
import { insertAndEnrichListings } from "@/lib/sync";
import type { NewListing } from "@/db/schema";

// AgentMail sends "message.received" events for inbound mail, signed via
// Svix (same HMAC scheme as e.g. Clerk/Resend webhooks). Zillow alert
// emails link listings as https://www.zillow.com/homedetails/{zpid}_zpid/
// — this regex pulls every zpid out of the raw HTML/text body.
const ZPID_RE = /(\d+)_zpid/g;

interface AgentMailMessageReceived {
  // AgentMail's real envelope carries the event kind in `event_type`
  // ("message.received", "message.received.spam", etc) — `type` is a
  // separate, constant field (always "event"). Verified 2026-09-04 against
  // docs.agentmail.to/api-reference/webhooks/events/message-received.md
  // after a real forwarded email produced a 200 with zero DB/Zillapi calls:
  // the route had been checking the wrong field (`type`) since day one, so
  // every genuine AgentMail delivery silently no-op'd despite my own
  // synthetic tests "passing" (they matched my own wrong assumption).
  type?: string;
  event_type?: string;
  message?: {
    subject?: string;
    html?: string;
    text?: string;
  };
}

// Zillow sends several alert types to the same inbox (price/status changes,
// tour reminders, open house reminders) — only new-listing ones should turn
// into leads. Verified against two real subject lines: an instant "Newly
// listed!" alert and a saved-search digest phrased "New Listing: <address>.
// Your '<search name>' search" — both are genuine "just hit the market"
// notifications, just worded differently depending on the alert type.
const NEWLY_LISTED_RE = /newly listed|new listing/i;

function extractZpids(body: string): string[] {
  return Array.from(new Set(Array.from(body.matchAll(ZPID_RE), (m) => m[1])));
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    console.error("agentmail webhook error", err);
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

async function handle(req: Request): Promise<Response> {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("AGENTMAIL_WEBHOOK_SECRET is not set");
    return new Response("Webhook not configured", { status: 500 });
  }

  const payload = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  try {
    // verify() only validates the signature and returns undefined (by
    // design, per node_modules/svix/src/webhook.ts) — it does NOT hand back
    // the parsed payload the way e.g. Stripe's SDK does, so the body still
    // has to be parsed separately below.
    new Webhook(secret).verify(payload, headers);
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(payload) as AgentMailMessageReceived;

  if (event.event_type !== "message.received") {
    // Logged rather than silently dropped — this exact class of bug (a
    // field-name mismatch nobody noticed because the response was still a
    // clean 200) is what caused two real forwarded emails to vanish with
    // no trace before this was caught.
    console.log("agentmail webhook: ignoring event_type", event.event_type, "raw type field:", event.type);
    return new Response("Ignored", { status: 200 });
  }

  if (!NEWLY_LISTED_RE.test(event.message?.subject ?? "")) {
    return new Response("Ignored: not a newly-listed alert", { status: 200 });
  }

  const body = (event.message?.html ?? "") + " " + (event.message?.text ?? "");
  const zpids = extractZpids(body);
  if (zpids.length === 0) {
    return new Response("No zpids found", { status: 200 });
  }

  const existing = await db
    .select({ zpid: listings.zpid })
    .from(listings)
    .where(inArray(listings.zpid, zpids));
  const existingSet = new Set(existing.map((l) => l.zpid));
  const newZpids = zpids.filter((z) => !existingSet.has(z));

  const fetched = await Promise.all(newZpids.map((zpid) => fetchFullListing(zpid)));
  const candidates = fetched
    .filter((l): l is NewListing => l !== null)
    .map((l) => ({ ...l, sourceLabel: "Zillow email alert" }));

  const inserted = await insertAndEnrichListings(candidates);

  return Response.json({ zpidsFound: zpids.length, inserted });
}
