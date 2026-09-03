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
  type?: string;
  message?: {
    subject?: string;
    html?: string;
    text?: string;
  };
}

// Zillow sends several alert types to the same inbox (price/status changes,
// tour reminders, saved-search digests) — only "Newly listed" ones should
// turn into leads.
const NEWLY_LISTED_RE = /newly listed/i;

function extractZpids(body: string): string[] {
  return Array.from(new Set(Array.from(body.matchAll(ZPID_RE), (m) => m[1])));
}

export async function POST(req: Request) {
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

  let event: AgentMailMessageReceived;
  try {
    event = new Webhook(secret).verify(payload, headers) as unknown as AgentMailMessageReceived;
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  if (event.type !== "message.received") {
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
