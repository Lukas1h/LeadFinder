import { db } from "@/db";
import { agents, listings, messagePresets, messageSends } from "@/db/schema";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { firstName, naturalStreetName } from "@/lib/sms";
import { byPriority, loadContactHistory, shortDate, shotAddresses, shotByHim, stillActive, volumeLine } from "./shared";
import type { FeedGroup, FeedItem } from "./types";

/**
 * "Replied to a photo offer": agents who answered one of his texts offering
 * to shoot a specific listing ("Bad Photos", "Coming Soon", or an AI draft
 * with the same pitch), after which the conversation stopped: nothing either
 * way for 3+ days. The listing has to still be for sale and not shot by him,
 * and the agent warm or better (a reply that leaves them cold was a no).
 * Gone once anyone says anything again, the send is marked booked or
 * declined, or the agent is declined or snoozed.
 */

const DAY = 24 * 60 * 60 * 1000;
/** Quiet at least this long since the last word either way. */
const QUIET_DAYS = 3;
/** Replies older than this are stale; the listing has likely been shot by someone. */
const MAX_DAYS = 45;
const OFFER_PRESETS = ["Bad Photos", "Coming Soon"];
/** An AI draft that offered to shoot the listing, not just a hello. */
const AI_OFFER = /professional photos|photos (lined up|handled|taken)|shoot (it|the property)|photo situation/i;

export async function getPhotoOfferRepliesGroup(): Promise<FeedGroup> {
  const group: FeedGroup = { title: "Replied, then went quiet", items: [], heldBack: 0 };
  const now = Date.now();
  const sends = await db
    .select({
      agentId: messageSends.agentId,
      listingId: messageSends.listingId,
      respondedAt: messageSends.respondedAt,
      result: messageSends.result,
      body: messageSends.body,
      preset: messagePresets.name,
    })
    .from(messageSends)
    .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
    .where(
      and(
        eq(messageSends.channel, "sms"),
        eq(messageSends.type, "initial_outreach"),
        inArray(messagePresets.name, [...OFFER_PRESETS, "AI Draft"]),
        isNotNull(messageSends.listingId),
        gte(messageSends.respondedAt, new Date(now - MAX_DAYS * DAY))
      )
    )
    .orderBy(desc(messageSends.respondedAt));

  // Each agent's latest reply to an offer.
  const offer = new Map<string, { listingId: string; repliedAt: Date; done: boolean }>();
  for (const s of sends) {
    if (!s.agentId || !s.listingId || !s.respondedAt || offer.has(s.agentId)) continue;
    if (s.preset === "AI Draft" && !AI_OFFER.test(s.body ?? "")) continue;
    offer.set(s.agentId, { listingId: s.listingId, repliedAt: s.respondedAt, done: s.result !== "pending" });
  }
  if (offer.size === 0) return group;
  const ids = [...offer.keys()];

  const [people, homes, shot] = await Promise.all([
    db.select().from(agents).where(inArray(agents.id, ids)),
    db.select().from(listings).where(inArray(listings.id, [...new Set([...offer.values()].map((o) => o.listingId))])),
    shotAddresses(),
  ]);
  const listingById = new Map(homes.map((l) => [l.id, l]));
  const history = await loadContactHistory(people);

  const items: FeedItem[] = [];
  for (const agent of people) {
    const o = offer.get(agent.id)!;
    const listing = listingById.get(o.listingId);
    if (o.done || !listing || !stillActive(listing) || shotByHim(listing, shot)) continue;
    // A real reply makes them warm; one still cold after replying said no thanks.
    if (agent.declinedAt || agent.relationshipStatus === "declined" || agent.relationshipStatus === "cold") continue;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    const last = Math.max(history.lastTouch.get(agent.id) ?? 0, o.repliedAt.getTime());
    if (now - last < QUIET_DAYS * DAY) {
      group.heldBack++;
      continue;
    }

    const street = naturalStreetName(listing.address);
    const quietDays = Math.floor((now - last) / DAY);
    items.push({
      agent,
      lastReplyAt: new Date(history.lastIn.get(agent.id) ?? o.repliedAt.getTime()),
      label: [
        `Replied ${shortDate(o.repliedAt)} about ${street ?? "their listing"}, quiet ${quietDays} days`,
        volumeLine(agent),
      ]
        .filter(Boolean)
        .join(" · "),
      suggestion: `Hey ${firstName(agent.name) ?? "there"}, just checking back on ${street ?? "your listing"}. Still want some photos for it? I've got some openings this week if so!`,
      listing,
      editorHref: null,
    });
  }
  group.items = byPriority(items);
  return group;
}
