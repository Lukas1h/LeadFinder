import { db } from "@/db";
import { agentInteractions, agents, listings, type Agent, type Listing } from "@/db/schema";
import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { distancePhrase, getRecentShoots, milesLabel, nearestShoot, type NearShoot } from "@/lib/nearShoots";
import { firstName, naturalStreetName } from "@/lib/sms";
import { byPriority, loadContactHistory, shortDate, shotAddresses, stillActive, volumeLine } from "./shared";
import type { FeedGroup } from "./types";

/**
 * "Shot one near you": warm agents with a listing for sale near a home he
 * shot in the last 30 days. The text opens with that shoot ("I just shot a
 * home a few blocks from your listing on Olive St, thought you'd like to see!")
 * and he attaches a photo from it himself, so fresh local work does the
 * selling: no offer, no discount, no work to make first.
 *
 * Who shows: interested, warm, regular and client agents, not declined or
 * snoozed, with an active listing that getRecentShoots/nearestShoot puts
 * within the shoot's radius (src/lib/nearShoots.ts: 1 mile in town, 3 in the
 * country), untouched for MIN_GAP_DAYS, not offered this in OFFERED_DAYS. One
 * card per agent: their listing nearest a shoot, in Lukas's priority order.
 */

export const FEED_KEY = "near_shoot";
const DAY = 24 * 60 * 60 * 1000;
const MIN_GAP_DAYS = 10;
const OFFERED_DAYS = 45;
// The suggestion itself ("I just shot a home…") and every earlier wording.
const OFFERED_RE = /just shot (a|one|another)/i;

export async function getNearShootGroup(): Promise<FeedGroup> {
  const group: FeedGroup = { title: "Near a home you just shot", items: [], heldBack: 0 };
  const [shoots, shot] = await Promise.all([getRecentShoots(), shotAddresses()]);
  if (shoots.length === 0) return group;

  const known = await db
    .select()
    .from(agents)
    .where(
      and(
        inArray(agents.relationshipStatus, ["interested", "warm", "regular", "worked_once"]),
        isNull(agents.declinedAt)
      )
    );
  if (known.length === 0) return group;
  const ids = known.map((a) => a.id);
  const now = Date.now();

  const [rows, history, offeredRows] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(and(inArray(listings.agentId, ids), isNotNull(listings.lat), isNotNull(listings.lng))),
    loadContactHistory(known),
    db
      .select({ agentId: agentInteractions.agentId })
      .from(agentInteractions)
      .where(
        and(
          inArray(agentInteractions.agentId, ids),
          eq(agentInteractions.direction, "outbound"),
          eq(agentInteractions.followUpFeed, FEED_KEY),
          gt(agentInteractions.occurredAt, new Date(now - OFFERED_DAYS * DAY))
        )
      ),
  ]);
  const offered = history.offered(OFFERED_RE);
  for (const o of offeredRows) offered.add(o.agentId);

  // The listing nearest a shoot, per agent.
  const nearest = new Map<string, { listing: Listing; near: NearShoot }>();
  for (const listing of rows) {
    if (!listing.agentId || !stillActive(listing)) continue;
    const near = nearestShoot(listing, shoots, shot);
    if (!near) continue;
    const prev = nearest.get(listing.agentId);
    if (!prev || near.miles < prev.near.miles) nearest.set(listing.agentId, { listing, near });
  }

  const byId = new Map(known.map((a) => [a.id, a]));
  for (const [agentId, { listing, near }] of nearest) {
    const agent = byId.get(agentId)!;
    if (offered.has(agentId)) continue;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    const touched = history.lastTouch.get(agentId) ?? 0;
    if (touched && now - touched < MIN_GAP_DAYS * DAY) {
      group.heldBack++;
      continue;
    }
    group.items.push(item(agent, listing, near, touched, history.lastIn.get(agentId) ?? 0));
  }
  group.items = byPriority(group.items);
  return group;
}

function item(agent: Agent, listing: Listing, near: NearShoot, touched: number, lastIn: number) {
  const name = firstName(agent.name);
  const hi = name ? `Hi ${name}!` : "Hi there!";
  const street = naturalStreetName(listing.address);
  const shoot = near.shoot;
  return {
    agent,
    lastReplyAt: lastIn ? new Date(lastIn) : null,
    label: [
      `Shot ${shoot.address} ${shortDate(shoot.shotAt)}`,
      `${milesLabel(near.miles)} away`,
      touched ? `Last in touch ${shortDate(new Date(touched))}` : null,
      volumeLine(agent),
    ]
      .filter(Boolean)
      .join(" · "),
    suggestion: `${hi} I just shot a home ${distancePhrase(near.miles)} ${
      street ? `your listing on ${street}` : "your listing"
    }, thought you'd like to see!`,
    listing,
    editorHref: null,
  };
}
