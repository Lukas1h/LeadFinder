import { db } from "@/db";
import {
  agents,
  agentInteractions,
  bookings,
  listings,
  messageSends,
  type Agent,
  type Listing,
} from "@/db/schema";
import { and, eq, inArray, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import { LEAD_GOOD_PHOTO_SCORE } from "@/lib/leadSections";
import { marketNews } from "@/lib/marketStatus";
import { firstName, naturalStreetName } from "@/lib/sms";
import { addressKey, type FollowUpBoard } from "./data";

/**
 * "AI photo touch-ups": a Follow up page feed (started 2026-10-20) built
 * around the photo editor. The main board only reacts to fresh events — a
 * listing seen in the last three weeks, a cut in the last two — so a home
 * that's been sitting with amateur photos never gives him a reason to text.
 * This feed is that reason: offer to run the listing's photos through the AI
 * editor and send the results. Free, and nobody has to be at the house — the
 * remote counterpart to the free-drone-shots feed (droneOffers.ts).
 *
 * Who shows: warm and interested agents with a listing that has been on the
 * market SITTING_DAYS or more, still active (no pending/sold from the nightly
 * market check), whose photos scored below the good-photos line, that he
 * didn't shoot and hasn't pitched. One listing per agent — a fresh price cut
 * wins, then the longest-sitting. The same floor as the rest of the page:
 * nobody he's touched in the last MIN_GAP_DAYS, and nobody snoozed.
 */

const DAY = 24 * 60 * 60 * 1000;
const TZ = "America/Los_Angeles";
/** The same floor the rest of the page uses: nobody within this many days of the last contact. */
const MIN_GAP_DAYS = 10;
/**
 * On the market at least this long. Anything newer belongs to the main
 * board's just-listed and price-cut reasons, which pitch a reshoot; this feed
 * is for the listings those windows have closed on.
 */
const SITTING_DAYS = 30;
/**
 * A cut within this long makes the listing the agent's best candidate: a cut
 * is when a listing gets relaunched, and new-looking photos are the obvious
 * thing to relaunch with.
 */
const CUT_BOOST_DAYS = 30;

export interface PhotoFixOfferItem {
  agent: Agent;
  lastReplyAt: Date | null;
  /** "Price cut Oct 3 · 45 days on market · photos 4/10" */
  label: string;
  /** A text to start from, in his voice. Fills Messages; he edits and sends. */
  suggestion: string;
  listing: Listing;
  /** The editor with this listing preloaded, for when they say yes. */
  editorUrl: string;
}

export interface PhotoFixOfferFeed {
  items: PhotoFixOfferItem[];
  /** Agents with a candidate who heard from him too recently to ask, so an empty feed explains itself. */
  heldBack: number;
}

const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });

export async function getPhotoFixOffers(): Promise<PhotoFixOfferFeed> {
  const known = await db
    .select()
    .from(agents)
    .where(and(inArray(agents.relationshipStatus, ["interested", "warm"]), isNull(agents.declinedAt)));
  if (known.length === 0) return { items: [], heldBack: 0 };
  const ids = known.map((a) => a.id);
  // Read after the first query, not before: the clock can't be read ahead of
  // request-time data while the page is prerendered (the build fails on it).
  const now = Date.now();
  const sittingBefore = new Date(now - SITTING_DAYS * DAY);

  const [candidates, sends, interactions, bookedAddresses] = await Promise.all([
    // Sitting, weak-photo listings of theirs that still have photos to edit.
    db
      .select()
      .from(listings)
      .where(
        and(
          inArray(listings.agentId, ids),
          lt(listings.score, LEAD_GOOD_PHOTO_SCORE),
          sql`cardinality(${listings.photos}) > 0`,
          lt(sql`coalesce(${listings.listedAt}, ${listings.foundAt})`, sittingBefore),
          eq(listings.isComingSoon, false),
          notInArray(listings.status, ["booked", "declined"])
        )
      ),
    db
      .select({
        agentId: messageSends.agentId,
        listingId: messageSends.listingId,
        sentAt: messageSends.sentAt,
        respondedAt: messageSends.respondedAt,
      })
      .from(messageSends)
      .where(inArray(messageSends.agentId, ids)),
    db
      .select({
        agentId: agentInteractions.agentId,
        listingId: agentInteractions.listingId,
        direction: agentInteractions.direction,
        at: agentInteractions.occurredAt,
      })
      .from(agentInteractions)
      .where(inArray(agentInteractions.agentId, ids)),
    db.select({ address: bookings.address }).from(bookings).where(isNotNull(bookings.address)),
  ]);

  const lastTouch = new Map<string, number>();
  const lastIn = new Map<string, number>();
  /** Listings already pitched — a templated send or a logged touch names the property. */
  const pitched = new Set<string>();
  const bump = (map: Map<string, number>, id: string, t: number) => map.set(id, Math.max(map.get(id) ?? 0, t));
  for (const a of known) if (a.lastContactedAt) bump(lastTouch, a.id, a.lastContactedAt.getTime());
  for (const s of sends) {
    if (!s.agentId) continue;
    bump(lastTouch, s.agentId, s.sentAt.getTime());
    if (s.respondedAt) {
      bump(lastTouch, s.agentId, s.respondedAt.getTime());
      bump(lastIn, s.agentId, s.respondedAt.getTime());
    }
    if (s.listingId) pitched.add(s.listingId);
  }
  for (const i of interactions) {
    bump(lastTouch, i.agentId, i.at.getTime());
    if (i.direction === "inbound") bump(lastIn, i.agentId, i.at.getTime());
    if (i.listingId) pitched.add(i.listingId);
  }

  const booked = new Set(bookedAddresses.map((b) => addressKey(b.address)).filter(Boolean));

  // Their candidates, best first: a fresh cut beats everything, then the
  // longest-sitting. Still on the market, not one of his shoots, not pitched.
  const cutBoostSince = now - CUT_BOOST_DAYS * DAY;
  const onMarketDays = (l: Listing) => Math.floor((now - (l.listedAt ?? l.foundAt).getTime()) / DAY);
  const byAgent = new Map<string, Listing[]>();
  for (const l of candidates) {
    if (!l.agentId) continue;
    if (marketNews(l.marketStatus)) continue;
    if (l.bookingId != null) continue;
    const key = addressKey(l.address);
    if (key != null && booked.has(key)) continue;
    if (pitched.has(l.id)) continue;
    const list = byAgent.get(l.agentId) ?? [];
    list.push(l);
    byAgent.set(l.agentId, list);
  }
  const recentCut = (l: Listing) => (l.priceCutAt && l.priceCutAt.getTime() > cutBoostSince ? 1 : 0);
  for (const list of byAgent.values()) {
    list.sort((a, b) => recentCut(b) - recentCut(a) || (a.listedAt ?? a.foundAt).getTime() - (b.listedAt ?? b.foundAt).getTime());
  }

  const items: PhotoFixOfferItem[] = [];
  let heldBack = 0;
  for (const agent of known) {
    const list = byAgent.get(agent.id);
    if (!list || list.length === 0) continue;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    const touched = lastTouch.get(agent.id) ?? 0;
    if (touched && now - touched < MIN_GAP_DAYS * DAY) {
      heldBack++;
      continue;
    }

    const listing = list[0];
    const days = onMarketDays(listing);
    const cut = recentCut(listing) === 1;
    const street = naturalStreetName(listing.address);
    const name = firstName(agent.name);
    const hey = name ? `Hey ${name}!` : "Hey there!";
    items.push({
      agent,
      lastReplyAt: lastIn.has(agent.id) ? new Date(lastIn.get(agent.id)!) : null,
      label:
        (cut ? `Price cut ${shortDate(listing.priceCutAt!)} · ` : "") +
        `${days} days on market · photos ${listing.score}/10`,
      suggestion: cut
        ? `${hey} Saw the price dropped${street ? ` on ${street}` : ""}. I've been trying out a new AI tool that touches up listing photos (lighting, windows, colors) — want me to run a few of yours through it and send you the results? Free, and I can do it all from here!`
        : `${hey} Saw ${street ? `your place on ${street}` : "your listing"} is still on the market. I've been trying out a new AI tool that touches up listing photos (lighting, windows, colors) — want me to run a few of yours through it and send you the results? Free, and I can do it all from here, no need for anyone to be at the house!`,
      listing,
      editorUrl: `/photo-editor?listing=${listing.id}`,
    });
  }

  items.sort((a, b) => recentCut(b.listing) - recentCut(a.listing) || onMarketDays(b.listing) - onMarketDays(a.listing));
  return { items, heldBack };
}

/**
 * Drop feed items whose listing the main board is already surfacing: a cut in
 * the board's two-week window puts the same property on both lists, once with
 * a reshoot pitch and once with this one. The board's reasons outlast the
 * overlap, so the feed defers. Everything else the board shows (a congrats, a
 * quiet nudge) is about a different property or none, and can stand next to
 * this offer.
 */
export function withoutBoardListings(feed: PhotoFixOfferFeed, board: FollowUpBoard): PhotoFixOfferFeed {
  const onBoard = new Set(
    [...board.today, ...board.later].map((e) => e.listing?.id).filter((id): id is string => id != null)
  );
  return { ...feed, items: feed.items.filter((i) => !onBoard.has(i.listing.id)) };
}
