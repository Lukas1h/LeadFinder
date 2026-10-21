import { db } from "@/db";
import { agents, agentInteractions, bookings, listings, messageSends, type Agent, type Listing } from "@/db/schema";
import { and, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { LEAD_GOOD_PHOTO_SCORE } from "@/lib/leadSections";
import { marketNews } from "@/lib/marketStatus";
import { firstName, naturalStreetName } from "@/lib/sms";
import { addressKey } from "../data";
import type { FeedGroup, FeedItem } from "./types";

/**
 * "Free photo touch-ups": warm and interested agents with a listing that has
 * been sitting with weak photos, offered a few AI-edited photos of it (the
 * photo editor, /photo-editor). He can do it from home, so unlike the drone
 * offer it works for anyone, anywhere.
 *
 * Who shows: warm or interested, not declined or snoozed, not in touch either
 * way for MIN_GAP_DAYS, never offered this before, with a listing that is
 * still active, isn't one he shot, scored under LEAD_GOOD_PHOTO_SCORE and has
 * been on the market MIN_DAYS_ON_MARKET. One listing each. A price cut in the
 * last CUT_DAYS puts them in the first group: the agent is relaunching it and
 * fresher photos are the obvious thing to relaunch with.
 */

const DAY = 24 * 60 * 60 * 1000;
const TZ = "America/Los_Angeles";
/** "Haven't been contacted in a little bit": a bit longer than the main list's 10-day floor. */
const MIN_GAP_DAYS = 14;
/** New listings are the main list's (just listed with weak photos); this is for the ones that have sat. */
const MIN_DAYS_ON_MARKET = 21;
const CUT_DAYS = 30;
/** An offer he made, in a logged note or a text: "touched up", "touch-up", "edited a few photos". */
const OFFERED_RE = /touch[\s-]?ups?|touched[\s-]?up|edit(?:ed|ing)? (?:a few|a couple|some|your|the) (?:of (?:the|your) )?photos/i;

const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });

/** Still for sale, as far as anything knows. Most listings have never had a market check (null). */
function stillActive(l: Listing): boolean {
  if (marketNews(l.marketStatus)) return false;
  return !l.marketStatus || /^active$|coming soon/i.test(l.marketStatus.trim());
}

export async function getPhotoTouchUpGroups(): Promise<FeedGroup[]> {
  const known = await db
    .select()
    .from(agents)
    .where(and(inArray(agents.relationshipStatus, ["interested", "warm"]), isNull(agents.declinedAt)));
  if (known.length === 0) return [];
  const ids = known.map((a) => a.id);
  // After the first query: the clock can't be read ahead of request-time data while prerendering.
  const now = Date.now();

  const [candidates, sends, interactions, booked] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(and(inArray(listings.agentId, ids), ne(listings.status, "booked"), isNotNull(listings.photos))),
    db
      .select({ agentId: messageSends.agentId, sentAt: messageSends.sentAt, respondedAt: messageSends.respondedAt, body: messageSends.body })
      .from(messageSends)
      .where(inArray(messageSends.agentId, ids)),
    db
      .select({ agentId: agentInteractions.agentId, at: agentInteractions.occurredAt, note: agentInteractions.note })
      .from(agentInteractions)
      .where(inArray(agentInteractions.agentId, ids)),
    db.select({ address: bookings.address }).from(bookings).where(isNotNull(bookings.address)),
  ]);

  const lastTouch = new Map<string, number>();
  const lastIn = new Map<string, number>();
  const offered = new Set<string>();
  const bump = (map: Map<string, number>, id: string, t: number) => map.set(id, Math.max(map.get(id) ?? 0, t));
  for (const a of known) if (a.lastContactedAt) bump(lastTouch, a.id, a.lastContactedAt.getTime());
  for (const s of sends) {
    if (!s.agentId) continue;
    bump(lastTouch, s.agentId, s.sentAt.getTime());
    if (s.respondedAt) {
      bump(lastTouch, s.agentId, s.respondedAt.getTime());
      bump(lastIn, s.agentId, s.respondedAt.getTime());
    }
    if (OFFERED_RE.test(s.body ?? "")) offered.add(s.agentId);
  }
  // A call or text either way holds them back the same.
  for (const i of interactions) {
    bump(lastTouch, i.agentId, i.at.getTime());
    if (OFFERED_RE.test(i.note ?? "")) offered.add(i.agentId);
  }

  const shot = new Set(booked.map((b) => addressKey(b.address)).filter(Boolean));
  const cutSince = now - CUT_DAYS * DAY;
  const daysOn = (l: Listing) => Math.floor((now - (l.listedAt ?? l.foundAt).getTime()) / DAY);
  const freshCut = (l: Listing) => l.priceCutAt != null && l.priceCutAt.getTime() > cutSince;

  // Each agent's best listing for this: a fresh cut first, then the weakest photos, then the longest on the market.
  const best = new Map<string, Listing>();
  const better = (a: Listing, b: Listing) =>
    Number(freshCut(b)) - Number(freshCut(a)) || (a.score ?? 10) - (b.score ?? 10) || daysOn(b) - daysOn(a);
  for (const l of candidates) {
    if (!l.agentId || !l.photos?.length || l.isComingSoon) continue;
    if (l.score == null || l.score >= LEAD_GOOD_PHOTO_SCORE) continue;
    if (daysOn(l) < MIN_DAYS_ON_MARKET || !stillActive(l)) continue;
    const key = addressKey(l.address);
    if (key && shot.has(key)) continue;
    const prev = best.get(l.agentId);
    if (!prev || better(l, prev) < 0) best.set(l.agentId, l);
  }

  const cuts: FeedGroup = { title: "Fresh price cut", items: [], heldBack: 0 };
  const sitting: FeedGroup = { title: "Sitting on the market", items: [], heldBack: 0 };
  for (const agent of known) {
    const listing = best.get(agent.id);
    if (!listing || offered.has(agent.id)) continue;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    const group = freshCut(listing) ? cuts : sitting;
    const touched = lastTouch.get(agent.id) ?? 0;
    if (touched && now - touched < MIN_GAP_DAYS * DAY) {
      group.heldBack++;
      continue;
    }
    group.items.push(item(agent, listing, touched, lastIn.get(agent.id) ?? 0, daysOn(listing), freshCut(listing)));
  }

  const rank = (a: Agent) => (a.relationshipStatus === "interested" ? 0 : 1);
  cuts.items.sort(
    (a, b) => rank(a.agent) - rank(b.agent) || b.listing!.priceCutAt!.getTime() - a.listing!.priceCutAt!.getTime()
  );
  sitting.items.sort(
    (a, b) => rank(a.agent) - rank(b.agent) || (a.listing!.score ?? 10) - (b.listing!.score ?? 10)
  );
  return [cuts, sitting].filter((g) => g.items.length > 0 || g.heldBack > 0);
}

function item(agent: Agent, listing: Listing, touched: number, lastIn: number, days: number, cut: boolean): FeedItem {
  const name = firstName(agent.name);
  const hey = name ? `Hey ${name}!` : "Hey there!";
  const street = naturalStreetName(listing.address);
  const on = street ? ` on ${street}` : "";
  return {
    agent,
    lastReplyAt: lastIn ? new Date(lastIn) : null,
    label: [
      cut ? `Price cut ${shortDate(listing.priceCutAt!)}` : null,
      `${days} days on market`,
      `photos ${listing.score}/10`,
      touched ? `last contact ${shortDate(new Date(touched))}` : "no contact logged",
    ]
      .filter(Boolean)
      .join(" · "),
    suggestion: cut
      ? `${hey} Saw the price change${on}. I'd be happy to touch up a few of the photos for you, free, to give it a fresh look for the relaunch. Want me to send some over?`
      : `${hey} Hope things are going well! I'd be happy to touch up a few of the photos${on} for you, totally free, just to give it a fresh look. Want me to send some over?`,
    listing,
    editorHref: `/photo-editor?listing=${listing.id}`,
  };
}
