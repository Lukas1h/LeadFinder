import { db } from "@/db";
import { agents, listings, type Agent, type Listing } from "@/db/schema";
import { and, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { firstName, naturalStreetName } from "@/lib/sms";
import { byPriority, loadContactHistory, shortDate, shotAddresses, shotByHim, stillActive, volumeLine } from "./shared";
import type { FeedGroup } from "./types";

/**
 * "Virtual staging": a vacant listing is the easy case for it (an empty room
 * photographs cold, and staging it is the obvious fix), and it's something
 * their own photographer usually didn't offer. Staged here externally, not
 * in the photo editor — the offer is the free demo, not the tool.
 *
 * There's no MLS description text in the schema to check for "vacant" — the
 * only free signal is the photo scorer's own reasoning (score_reasoning),
 * which occasionally calls out empty/unstaged rooms as part of critiquing
 * the photos. That's a real signal, not a guess, but a thin one: 2 of ~2,500
 * tracked listings mention it as of 2026-10-22. This feed will be quiet
 * until there's a direct source (e.g. a listing-description field) to check.
 *
 * Who shows: warm and interested agents, not declined or snoozed, untouched
 * for MIN_GAP_DAYS, never offered this before, with an active listing he
 * didn't shoot whose score reasoning reads as vacant/unfurnished. Their
 * newest such listing, in priority order.
 */

const DAY = 24 * 60 * 60 * 1000;
const MIN_GAP_DAYS = 14;
const OFFERED_RE = /staging|staged/i;
/** "Vacant", "unfurnished", "no furniture", "empty room(s)/space(s)/home/house/property". */
const VACANT_RE = /\bvacant\b|\bunfurnished\b|\bno furniture\b|\bempty\b[^.]{0,20}\b(home|house|property|room|rooms|space|spaces)\b/i;

export async function getStagingGroup(): Promise<FeedGroup> {
  const group: FeedGroup = { title: "Vacant listing", items: [], heldBack: 0 };
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
          isNotNull(listings.scoreReasoning)
        )
      ),
    loadContactHistory(known),
    shotAddresses(),
  ]);
  const offered = history.offered(OFFERED_RE);

  const byId = new Map(known.map((a) => [a.id, a]));
  const newest = new Map<string, Listing>();
  for (const l of rows) {
    if (!l.agentId || !VACANT_RE.test(l.scoreReasoning ?? "") || !stillActive(l) || shotByHim(l, shot)) continue;
    const prev = newest.get(l.agentId);
    if (!prev || (l.listedAt ?? l.foundAt) > (prev.listedAt ?? prev.foundAt)) newest.set(l.agentId, l);
  }

  for (const [agentId, listing] of newest) {
    const agent = byId.get(agentId)!;
    if (offered.has(agentId)) continue;
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
      "Vacant",
      listing.city,
      volumeLine(agent),
      touched ? `last contact ${shortDate(new Date(touched))}` : "no contact logged",
    ]
      .filter(Boolean)
      .join(" · "),
    suggestion: `${hey} Saw ${street ?? "your listing"} is vacant — I can virtually stage a photo of it for free, just to show how the space could look furnished. Want me to send one over?`,
    listing,
    editorHref: null,
  };
}
