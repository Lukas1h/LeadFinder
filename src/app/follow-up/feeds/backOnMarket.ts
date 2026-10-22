import { db } from "@/db";
import { agents, listings, type Agent, type Listing } from "@/db/schema";
import { and, gt, inArray, isNull } from "drizzle-orm";
import { firstName, naturalStreetName } from "@/lib/sms";
import { byPriority, loadContactHistory, shortDate, shotAddresses, shotByHim, stillActive, volumeLine } from "./shared";
import type { FeedGroup } from "./types";

/**
 * The Relaunch feed's strongest half: a listing of someone he knows went
 * under contract or pending and is back on the market (listings.
 * backOnMarketAt, stamped by the nightly market check). The deal fell
 * through, the agent is relaunching and motivated, and fresh photos are the
 * obvious thing to relaunch with.
 *
 * Who shows: clients, interested and warm agents, not declined or snoozed,
 * the listing back on in the last WINDOW_DAYS, still for sale, not one he
 * shot, and no contact since it came back (nor within MIN_GAP_DAYS).
 */

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 21;
const MIN_GAP_DAYS = 10;

export async function getBackOnMarketGroup(): Promise<FeedGroup> {
  const group: FeedGroup = { title: "Back on the market", items: [], heldBack: 0 };
  const known = await db
    .select()
    .from(agents)
    .where(and(inArray(agents.relationshipStatus, ["regular", "worked_once", "interested", "warm"]), isNull(agents.declinedAt)));
  if (known.length === 0) return group;
  const now = Date.now();

  const [rows, history, shot] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(and(inArray(listings.agentId, known.map((a) => a.id)), gt(listings.backOnMarketAt, new Date(now - WINDOW_DAYS * DAY)))),
    loadContactHistory(known),
    shotAddresses(),
  ]);

  const byId = new Map(known.map((a) => [a.id, a]));
  const newest = new Map<string, Listing>();
  for (const l of rows) {
    if (!l.agentId || !stillActive(l) || shotByHim(l, shot)) continue;
    const prev = newest.get(l.agentId);
    if (!prev || l.backOnMarketAt! > prev.backOnMarketAt!) newest.set(l.agentId, l);
  }

  for (const [agentId, listing] of newest) {
    const agent = byId.get(agentId)!;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    const touched = history.lastTouch.get(agentId) ?? 0;
    const back = listing.backOnMarketAt!.getTime();
    if (touched > back) continue; // he's already been in touch since it came back
    if (touched && now - touched < MIN_GAP_DAYS * DAY) {
      group.heldBack++;
      continue;
    }
    group.items.push(item(agent, listing, history.lastIn.get(agentId) ?? 0));
  }
  group.items = byPriority(group.items);
  return group;
}

function item(agent: Agent, listing: Listing, lastIn: number) {
  const name = firstName(agent.name);
  const hey = name ? `Hey ${name}!` : "Hey there!";
  const street = naturalStreetName(listing.address);
  return {
    agent,
    lastReplyAt: lastIn ? new Date(lastIn) : null,
    label: [`Back on the market ${shortDate(listing.backOnMarketAt!)}`, listing.city, volumeLine(agent)].filter(Boolean).join(" · "),
    suggestion: `${hey} Saw ${street ?? "your listing"} is back on the market, sorry the deal fell through! If you want some fresh photos for the relaunch I'd love to help, I can get out there this week.`,
    listing,
    editorHref: `/photo-editor?listing=${listing.id}`,
  };
}
