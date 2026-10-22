import { db } from "@/db";
import { agents, listings, type Agent, type Listing } from "@/db/schema";
import { and, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { LEAD_GOOD_PHOTO_SCORE } from "@/lib/leadSections";
import { firstName, naturalStreetName } from "@/lib/sms";
import { byPriority, loadContactHistory, shortDate, shotAddresses, shotByHim, stillActive, volumeLine } from "./shared";
import type { FeedGroup, FeedItem } from "./types";

/**
 * The Relaunch feed's weak-photo half: warm and interested agents with a
 * listing that has sat with weak photos. The offer is one photo edited with
 * the photo editor, as a demo of what fresh photos would do, and the ask is
 * the reshoot (2026-10-21: giving away a whole edited set replaces the job
 * he's trying to win, and the photos are usually another photographer's).
 *
 * Who shows: warm or interested, not declined or snoozed, not in touch either
 * way for MIN_GAP_DAYS, never offered this before, with a listing that is
 * still active, isn't one he shot, scored under LEAD_GOOD_PHOTO_SCORE and has
 * been on the market MIN_DAYS_ON_MARKET. One listing each, in Lukas's
 * priority order. A price cut in the last CUT_DAYS puts them in the first group.
 */

const DAY = 24 * 60 * 60 * 1000;
/** "Haven't been contacted in a little bit": a bit longer than the main list's 10-day floor. */
const MIN_GAP_DAYS = 14;
/** New listings are the New listings feed's; this is for the ones that have sat. */
const MIN_DAYS_ON_MARKET = 21;
const CUT_DAYS = 30;
/** An offer he made, in a logged note or a text: "touched up", "edited one of the photos". */
const OFFERED_RE = /touch[\s-]?ups?|touched[\s-]?up|edit(?:ed|ing)? (?:a few|a couple|some|one|your|the) (?:of (?:the|your) )?photos?/i;

export async function getPhotoTouchUpGroups(): Promise<FeedGroup[]> {
  const known = await db
    .select()
    .from(agents)
    .where(and(inArray(agents.relationshipStatus, ["interested", "warm"]), isNull(agents.declinedAt)));
  if (known.length === 0) return [];
  const ids = known.map((a) => a.id);
  // After the first query: the clock can't be read ahead of request-time data while prerendering.
  const now = Date.now();

  const [candidates, history, shot] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(and(inArray(listings.agentId, ids), ne(listings.status, "booked"), isNotNull(listings.photos))),
    loadContactHistory(known),
    shotAddresses(),
  ]);
  const offered = history.offered(OFFERED_RE);

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
    if (daysOn(l) < MIN_DAYS_ON_MARKET || !stillActive(l) || shotByHim(l, shot)) continue;
    const prev = best.get(l.agentId);
    if (!prev || better(l, prev) < 0) best.set(l.agentId, l);
  }

  const cuts: FeedGroup = { title: "Price cut", items: [], heldBack: 0 };
  const sitting: FeedGroup = { title: "Sitting with weak photos", items: [], heldBack: 0 };
  for (const agent of known) {
    const listing = best.get(agent.id);
    if (!listing || offered.has(agent.id)) continue;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    const group = freshCut(listing) ? cuts : sitting;
    const touched = history.lastTouch.get(agent.id) ?? 0;
    if (touched && now - touched < MIN_GAP_DAYS * DAY) {
      group.heldBack++;
      continue;
    }
    group.items.push(item(agent, listing, touched, history.lastIn.get(agent.id) ?? 0, daysOn(listing), freshCut(listing)));
  }
  cuts.items = byPriority(cuts.items);
  sitting.items = byPriority(sitting.items);
  return [cuts, sitting];
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
      volumeLine(agent),
      touched ? `last contact ${shortDate(new Date(touched))}` : "no contact logged",
    ]
      .filter(Boolean)
      .join(" · "),
    suggestion: cut
      ? `${hey} Saw the price change${on}. I edited one of the photos to show what fresh ones could do for the relaunch, want me to send it over? Happy to reshoot it this week if you'd like!`
      : `${hey} Hope things are going well! I edited one of the photos${on} just to show what some fresh ones could do, want me to send it over? Happy to reshoot it if you'd like!`,
    listing,
    editorHref: `/photo-editor?listing=${listing.id}`,
  };
}
