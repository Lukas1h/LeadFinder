import { Webhook } from "svix";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { fetchFullListing } from "@/lib/zillapi";
import { insertAndEnrichListings } from "@/lib/sync";
import { fetchAgentMailMessage } from "@/lib/agentmail";
import type { NewListing } from "@/db/schema";

export const maxDuration = 60;

// AgentMail sends "message.received" events for inbound mail, signed via
// Svix (same HMAC scheme as e.g. Clerk/Resend webhooks). Zillow alert
// emails link listings as https://www.zillow.com/homedetails/{zpid}_zpid/
// — this regex pulls zpids out of the raw HTML/text body. Global-flagged
// on purpose now (extractLeadZpids below always builds a fresh RegExp
// per call via matchAll's own copy, so there's no cross-call lastIndex
// state to worry about — see extractLeadZpids' own comment).
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
    message_id?: string;
    inbox_id?: string;
    subject?: string;
    html?: string;
    text?: string;
  };
}

// Trying to enumerate every "this means a fresh lead" subject phrasing was
// a losing game — three different real formats ("Newly listed!"/"New
// Listing: <addr>", "Just listed at $<price> in <area>", "<N> Result(s)
// for '<saved search>'") each slipped through a narrower include-list
// before being caught, one at a time, each time after a real email had
// already been silently dropped. Flipped 2026-09-05 to an exclude-list
// instead: accept anything except the alert types that are clearly NOT an
// outreach opportunity. None of these exact phrases are verified against
// a real subject line yet (no example seen so far) — written defensively
// from Zillow's known alert categories, to be corrected the first time
// one of these actually fires.
const EXCLUDED_ALERT_RE = /sale pending|pending sale|\bsold\b|off.?market|tour reminder|open house reminder/i;

// Zillow's "New Listing: <addr>. Your search" digest puts the one real
// result first, then a "Our recommendations for you / Based on your
// recent activity" section linking several unrelated listings — verified
// against a real email (Fwd: New Listing: 1466 SE Pine St): 7 unique
// zpids total, only the first matched the subject's address, the other 6
// were unrelated recommendations. Cutting the body off at this marker
// before extracting zpids keeps that digest to just its real result,
// while every other format tried (single "Just listed" alerts, "<N>
// Result(s) for" digests) has no such section at all, so the cut is a
// no-op for them and every genuine result they contain gets extracted.
const RECOMMENDATIONS_SECTION_RE = /our recommendations for you|based on your recent activity/i;

/**
 * Extracts every real (non-recommended) zpid mentioned in an alert's body.
 * A single-listing alert repeats its one zpid 2-3x (thumbnail/address/
 * button links to the same property) — deduping with a Set collapses
 * that back to one. A "<N> Result(s) for" digest genuinely contains N
 * different real results — verified against two real emails ("2 Results
 * for 'Newest Luxury Listings in Eugene'" → 2 unique zpids, "1 Result for
 * 'New Douglas Listings'" → 1) — so all of them are extracted, not just
 * the first.
 */
function extractLeadZpids(body: string): string[] {
  const cut = body.search(RECOMMENDATIONS_SECTION_RE);
  const relevant = cut === -1 ? body : body.slice(0, cut);
  const matches = [...relevant.matchAll(ZPID_RE)].map((m) => m[1]);
  return [...new Set(matches)];
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
  if (EXCLUDED_ALERT_RE.test(subject)) {
    console.log("agentmail webhook: excluded alert type:", subject);
    return new Response("Ignored: not an outreach opportunity", { status: 200 });
  }

  let body = (event.message?.html ?? "") + " " + (event.message?.text ?? "");
  let zpids = extractLeadZpids(body);

  if (zpids.length === 0 && event.message?.message_id && event.message?.inbox_id) {
    // The webhook's inline body didn't contain a zpid — re-fetch the
    // message directly rather than trusting the inline copy, since a real
    // delivery has already been seen where the two disagreed (see
    // fetchAgentMailMessage's doc comment).
    const full = await fetchAgentMailMessage(event.message.inbox_id, event.message.message_id);
    if (full) {
      body = (full.html ?? "") + " " + (full.text ?? "");
      zpids = extractLeadZpids(body);
    }
  }

  if (zpids.length === 0) {
    console.log("agentmail webhook: no zpid found, subject:", subject);
    return new Response("No zpid found", { status: 200 });
  }

  const existingRows = await db.select({ zpid: listings.zpid }).from(listings).where(inArray(listings.zpid, zpids));
  const existingZpids = new Set(existingRows.map((r) => r.zpid));
  const newZpids = zpids.filter((z) => !existingZpids.has(z));

  const fetched = await Promise.all(newZpids.map((zpid) => fetchFullListing(zpid)));
  const candidates = fetched
    .filter((l): l is NewListing => l !== null)
    .map((l) => ({ ...l, sourceLabel: "Zillow email alert" }) satisfies NewListing);

  const inserted = await insertAndEnrichListings(candidates);

  return Response.json({ zpids, alreadyExisted: existingZpids.size, fetchFailed: newZpids.length - candidates.length, inserted });
}
