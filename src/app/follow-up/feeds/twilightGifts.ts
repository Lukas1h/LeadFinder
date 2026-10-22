import { db } from "@/db";
import { agents, listings, type Agent, type Listing } from "@/db/schema";
import { and, gt, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { LEAD_GOOD_PHOTO_SCORE } from "@/lib/leadSections";
import { firstName, naturalStreetName } from "@/lib/sms";
import { byPriority, loadContactHistory, shortDate, shotAddresses, shotByHim, stillActive, volumeLine } from "./shared";
import type { FeedGroup } from "./types";

/**
 * "Twilight gift": the warm-to-interested converter (2026-10-21). For an
 * agent whose newest listing already has decent photos (so they have a
 * photographer, and a reshoot pitch goes nowhere), a twilight version of the
 * front photo, made with the photo editor's sunset preset: something their
 * photographer didn't deliver and they can't make themselves. One photo,
 * free; a yes is an easy reply, which is what moves warm to interested.
 *
 * Who shows: warm and interested agents, not declined or snoozed, untouched
 * for MIN_GAP_DAYS, never offered a twilight, with an active listing from
 * the last LISTED_DAYS that he didn't shoot and that scored at or above
 * LEAD_GOOD_PHOTO_SCORE (weak-photo listings are the Relaunch feed's). Their
 * newest such listing, in Lukas's priority order (volume, price, location).
 */

const DAY = 24 * 60 * 60 * 1000;
const MIN_GAP_DAYS = 14;
const LISTED_DAYS = 60;
const OFFERED_RE = /twilight/i;

export async function getTwilightGiftGroup(skipAgentIds: Set<string>): Promise<FeedGroup> {
  const group: FeedGroup = { title: "Newest listing with good photos", items: [], heldBack: 0 };
  const known = await db
    .select()
    .from(agents)
    .where(and(inArray(agents.relationshipStatus, ["interested", "warm"]), isNull(agents.declinedAt)));
  if (known.length === 0) return group;
  const now = Date.now();

  const [rows, history, shot] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(
        and(
          inArray(listings.agentId, known.map((a) => a.id)),
          ne(listings.status, "booked"),
          isNotNull(listings.photos),
          gt(listings.foundAt, new Date(now - LISTED_DAYS * DAY))
        )
      ),
    loadContactHistory(known),
    shotAddresses(),
  ]);
  const offered = history.offered(OFFERED_RE);

  const newest = new Map<string, Listing>();
  for (const l of rows) {
    if (!l.agentId || !l.photos?.length || l.isComingSoon) continue;
    if (l.score == null || l.score < LEAD_GOOD_PHOTO_SCORE || !stillActive(l) || shotByHim(l, shot)) continue;
    const at = (l.listedAt ?? l.foundAt).getTime();
    if (now - at > LISTED_DAYS * DAY) continue;
    const prev = newest.get(l.agentId);
    if (!prev || at > (prev.listedAt ?? prev.foundAt).getTime()) newest.set(l.agentId, l);
  }

  const byId = new Map(known.map((a) => [a.id, a]));
  for (const [agentId, listing] of newest) {
    const agent = byId.get(agentId)!;
    if (offered.has(agentId) || skipAgentIds.has(agentId)) continue;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    const touched = history.lastTouch.get(agentId) ?? 0;
    if (touched && now - touched < MIN_GAP_DAYS * DAY) {
      group.heldBack++;
      continue;
    }
    group.items.push(item(agent, listing, touched, history.lastIn.get(agentId) ?? 0));
  }
  group.items = byPriority(group.items);
  return group;
}

function item(agent: Agent, listing: Listing, touched: number, lastIn: number) {
  const name = firstName(agent.name);
  const hey = name ? `Hey ${name}!` : "Hey there!";
  const street = naturalStreetName(listing.address);
  return {
    agent,
    lastReplyAt: lastIn ? new Date(lastIn) : null,
    label: [
      `Listed ${shortDate(listing.listedAt ?? listing.foundAt)}`,
      listing.city,
      volumeLine(agent),
      touched ? `last contact ${shortDate(new Date(touched))}` : "no contact logged",
    ]
      .filter(Boolean)
      .join(" · "),
    // Make it before sending this: the text says it's done.
    suggestion: `${hey} I made a twilight version of the front photo of your ${street ? `${street} listing` : "new listing"} just for fun, it came out really nice. Want me to send it over? No strings attached!`,
    listing,
    editorHref: `/photo-editor?listing=${listing.id}&preset=sunset-exterior`,
  };
}
