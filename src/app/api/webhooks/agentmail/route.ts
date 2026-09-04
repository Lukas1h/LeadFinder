import { Webhook } from "svix";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fetchFullListing } from "@/lib/zillapi";
import { insertAndEnrichListings } from "@/lib/sync";
import { fetchAgentMailMessage } from "@/lib/agentmail";
import type { NewListing } from "@/db/schema";

export const maxDuration = 60;

// AgentMail sends "message.received" events for inbound mail, signed via
// Svix (same HMAC scheme as e.g. Clerk/Resend webhooks). Zillow alert
// emails link listings as https://www.zillow.com/homedetails/{zpid}_zpid/
// — this regex pulls a zpid out of the raw HTML/text body. Deliberately
// NOT global: extractMainZpid only ever wants the first match, and a
// module-level `g`-flagged RegExp keeps `lastIndex` state across calls,
// which would silently break every other webhook invocation.
const ZPID_RE = /(\d+)_zpid/;

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
    message_id?: string;
    inbox_id?: string;
    subject?: string;
    html?: string;
    text?: string;
  };
}

// Zillow sends several alert types to the same inbox. Two are confirmed to
// be worth turning into a lead (a property newly available to pitch), and
// one — a price cut — was added by request 2026-09-04 on the reasoning
// that a stale/reduced listing is as much an outreach opportunity as a
// fresh one. Real, verified subject lines: "Newly listed!" (instant
// alert), "New Listing: <address>. Your '<search name>' search"
// (saved-search digest), "Just listed at $<price> in <area>" (direct
// per-search instant update — missed for a full day before this regex
// existed; two real emails silently never matched the original
// new-listing-only pattern and only became leads because the daily bbox
// sync independently found the same properties), and "Price Cut:
// <address>...". "back on market"/"relisted" are NOT yet verified against
// a real subject line — included as a reasonable guess for a listing that
// was off-market and is available again, same outreach value as new/cut.
const NEWLY_LISTED_RE = /newly listed|new listing|just listed|price cut|back on market|relisted/i;

// Never turn these into a lead even if NEWLY_LISTED_RE also matches
// somewhere in the subject — a property that's sold/pending/off-market is
// not an outreach opportunity, and tour/open-house reminders are
// logistics for an existing showing, not a new lead signal. None of these
// patterns are verified against a real subject line yet (no example seen
// so far) — written defensively from Zillow's known alert categories, to
// be corrected against a real subject the first time one of these fires.
const EXCLUDED_ALERT_RE = /sale pending|pending sale|\bsold\b|off.?market|tour reminder|open house reminder/i;

/**
 * Zillow's alert emails put the actual "new listing" the alert is about
 * first, then a "Based on your recent activity / Our recommendations for
 * you" section linking several unrelated listings. Verified against two
 * real emails: the first zpid mentioned always matches the address in the
 * subject line, and every zpid after it belongs to a recommended listing
 * we did NOT ask about — so only the first one should turn into a lead.
 */
function extractMainZpid(body: string): string | null {
  const match = ZPID_RE.exec(body);
  return match?.[1] ?? null;
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

  const subject = event.message?.subject ?? "";
  if (EXCLUDED_ALERT_RE.test(subject) || !NEWLY_LISTED_RE.test(subject)) {
    console.log("agentmail webhook: subject doesn't match a lead-worthy alert:", subject);
    return new Response("Ignored: not a lead-worthy alert", { status: 200 });
  }

  let body = (event.message?.html ?? "") + " " + (event.message?.text ?? "");
  let zpid = extractMainZpid(body);

  if (!zpid && event.message?.message_id && event.message?.inbox_id) {
    // The webhook's inline body didn't contain a zpid — re-fetch the
    // message directly rather than trusting the inline copy, since a real
    // delivery has already been seen where the two disagreed (see
    // fetchAgentMailMessage's doc comment).
    const full = await fetchAgentMailMessage(event.message.inbox_id, event.message.message_id);
    if (full) {
      body = (full.html ?? "") + " " + (full.text ?? "");
      zpid = extractMainZpid(body);
    }
  }

  if (!zpid) {
    console.log("agentmail webhook: no zpid found, subject:", event.message?.subject);
    return new Response("No zpid found", { status: 200 });
  }

  const [existing] = await db.select({ zpid: listings.zpid }).from(listings).where(eq(listings.zpid, zpid));
  if (existing) {
    return Response.json({ zpid, inserted: 0, reason: "already exists" });
  }

  const fresh = await fetchFullListing(zpid);
  const inserted = fresh
    ? await insertAndEnrichListings([{ ...fresh, sourceLabel: "Zillow email alert" } satisfies NewListing])
    : 0;

  return Response.json({ zpid, inserted });
}
