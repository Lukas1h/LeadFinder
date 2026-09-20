import { Webhook } from "svix";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { fetchFullListing } from "@/lib/zillapi";
import { insertAndEnrichListings } from "@/lib/sync";
import { fetchAgentMailMessage } from "@/lib/agentmail";
import type { NewListing } from "@/db/schema";

// See matching comment in src/app/page.tsx — Hobby plan's real ceiling is
// 300s with Fluid compute, and 60 wasn't leaving enough margin.
export const maxDuration = 300;

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

// Zillow's "New Listing: <addr>. Your search" digest (and the "instant
// home recs" price-cut alert, e.g. "A $5K price cut in Sutherlin") puts
// the one real result first, then a recommendation carousel — headed
// "Our recommendations for you" / "Based on your recent activity" /
// "Improve your recommendations" depending on the template — linking
// several unrelated listings. Verified against real emails: one digest
// had 7 unique zpids total, only the first matched the subject; another
// (a price-cut alert, 2026-09-20) had the same shape but its carousel
// heading wasn't one of the two patterns previously matched here, so all
// 6 carousel zpids slipped through as if they were the real result.
//
// Rather than discard the carousel outright (a genuinely new listing can
// legitimately show up as a "recommendation"), zpids found after this
// marker are kept but only trusted if the listing itself is recent — see
// RECOMMENDATION_MAX_AGE_DAYS below.
const RECOMMENDATIONS_SECTION_RE = /our recommendations for you|based on your recent activity|improve your recommendations/i;

// How new a "recommended" listing has to be (by Zillow's own daysOnZillow)
// to be trusted as a real lead rather than noise from the recommendation
// carousel. A zpid that appears in the email's main body (before the
// recommendations marker) is always trusted regardless of age — the email
// is specifically about that listing (e.g. a price cut on a long-listed
// property), so its own listing age says nothing about relevance.
const RECOMMENDATION_MAX_AGE_DAYS = 10;

/**
 * Splits every zpid mentioned in an alert's body into "trusted" (appears
 * before any recommendations-section marker, or the email has no such
 * section at all) and "recommended" (appears only after one). A
 * single-listing alert repeats its one zpid 2-3x (thumbnail/address/
 * button links to the same property) — deduping with a Set collapses
 * that back to one. A "<N> Result(s) for" digest genuinely contains N
 * different real results — verified against two real emails ("2 Results
 * for 'Newest Luxury Listings in Eugene'" → 2 unique zpids, "1 Result for
 * 'New Douglas Listings'" → 1) — so all of them land in `trusted`, not
 * just the first.
 */
function splitLeadZpids(body: string): { trusted: string[]; recommended: string[] } {
  const cut = body.search(RECOMMENDATIONS_SECTION_RE);
  if (cut === -1) {
    return { trusted: [...new Set([...body.matchAll(ZPID_RE)].map((m) => m[1]))], recommended: [] };
  }
  const trusted = [...new Set([...body.slice(0, cut).matchAll(ZPID_RE)].map((m) => m[1]))];
  const trustedSet = new Set(trusted);
  const recommended = [...new Set([...body.slice(cut).matchAll(ZPID_RE)].map((m) => m[1]))].filter(
    (z) => !trustedSet.has(z)
  );
  return { trusted, recommended };
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
  let { trusted, recommended } = splitLeadZpids(body);

  if (trusted.length === 0 && recommended.length === 0 && event.message?.message_id && event.message?.inbox_id) {
    // The webhook's inline body didn't contain a zpid — re-fetch the
    // message directly rather than trusting the inline copy, since a real
    // delivery has already been seen where the two disagreed (see
    // fetchAgentMailMessage's doc comment).
    const full = await fetchAgentMailMessage(event.message.inbox_id, event.message.message_id);
    if (full) {
      body = (full.html ?? "") + " " + (full.text ?? "");
      ({ trusted, recommended } = splitLeadZpids(body));
    }
  }

  const zpids = [...trusted, ...recommended];
  if (zpids.length === 0) {
    console.log("agentmail webhook: no zpid found, subject:", subject);
    return new Response("No zpid found", { status: 200 });
  }

  const existingRows = await db.select({ zpid: listings.zpid }).from(listings).where(inArray(listings.zpid, zpids));
  const existingZpids = new Set(existingRows.map((r) => r.zpid));
  const trustedSet = new Set(trusted);
  const newZpids = zpids.filter((z) => !existingZpids.has(z));

  const fetched = await Promise.all(newZpids.map((zpid) => fetchFullListing(zpid)));
  const recommendationCutoff = new Date(Date.now() - RECOMMENDATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const staleRecommendations: string[] = [];
  const candidates = fetched
    .filter((l): l is NewListing => l !== null)
    .filter((l) => {
      if (trustedSet.has(l.zpid)) return true;
      const recent = l.listedAt != null && l.listedAt >= recommendationCutoff;
      if (!recent) staleRecommendations.push(l.zpid);
      return recent;
    })
    .map((l) => ({ ...l, sourceLabel: "Zillow email alert" }) satisfies NewListing);

  const inserted = await insertAndEnrichListings(candidates);

  if (staleRecommendations.length > 0) {
    console.log("agentmail webhook: skipped stale recommendations", staleRecommendations);
  }

  return Response.json({
    zpids,
    alreadyExisted: existingZpids.size,
    skippedStaleRecommendations: staleRecommendations.length,
    fetchFailed: newZpids.length - candidates.length - staleRecommendations.length,
    inserted,
  });
}
