import { db } from "@/db";
import { agentInteractions, followUpPasses, messagePresets, messageSends } from "@/db/schema";
import { and, eq, inArray, isNotNull, isNull, max, ne, or } from "drizzle-orm";
import type { FeedItem, FollowUpFeedKey } from "./types";

/**
 * Three rules every feed follows, applied once in buildFeeds rather than in
 * each feed's own query:
 *
 * 1. **Pass.** He passed this agent on this feed (follow_up_passes): gone
 *    from that feed only. A pass made on a card about a listing covers that
 *    listing, so their next one can still come up; one without a listing
 *    covers the agent in that feed for good.
 *
 * 2. **Never the same text twice.** Each feed is one template, and sending
 *    it again to someone who already got it reads like he forgot. So once a
 *    text or call went out from a feed (agent_interactions.follow_up_feed,
 *    recorded since 2026-10-21), that agent doesn't come back to it. The
 *    exception is feeds that are about something new each time (a sale, a
 *    new listing, a check-in after a gap, a graphic for another home he
 *    shot): those can come back, but only
 *    once the agent has replied since the last one. Congrats on a pending,
 *    they reply, a month later another one goes pending: fine. Congrats,
 *    no reply, another pending: they never answered the first, so no.
 *
 * 3. **Only people he's texted.** Every card is a text, and a first text from
 *    an unknown number to an agent he's only emailed is confusing. So an
 *    agent shows only with a text history: a text out (a logged one, or a
 *    send from an SMS template) or a text in. Drone shots is the one
 *    exception: it has its own email template for the people he emails.
 */
const EMAIL_OK: ReadonlySet<FollowUpFeedKey> = new Set(["drone"]);
export const REPEAT_AFTER_REPLY: ReadonlySet<FollowUpFeedKey> = new Set(["congrats", "new_listings", "check_ins", "graphics"]);

export interface FeedHistory {
  /** "agent|feed|listing" for a listing pass, "agent|feed|" for a whole-feed one. */
  passes: Set<string>;
  /** "agent|feed" → when the last text or call from that feed went out. */
  lastFromFeed: Map<string, number>;
  /** Their last reply, any channel. */
  lastIn: Map<string, number>;
  /** Agents with any text history, either way. */
  texted: Set<string>;
}

export async function loadFeedHistory(): Promise<FeedHistory> {
  const [passes, fromFeed, texts, smsSends] = await Promise.all([
    db.select({ agentId: followUpPasses.agentId, feed: followUpPasses.feed, listingId: followUpPasses.listingId }).from(followUpPasses),
    db
      .select({ agentId: agentInteractions.agentId, feed: agentInteractions.followUpFeed, at: max(agentInteractions.occurredAt) })
      .from(agentInteractions)
      .where(and(eq(agentInteractions.direction, "outbound"), isNotNull(agentInteractions.followUpFeed)))
      .groupBy(agentInteractions.agentId, agentInteractions.followUpFeed),
    // A text either way; an outbound one he said didn't go out doesn't count.
    db
      .selectDistinct({ agentId: agentInteractions.agentId })
      .from(agentInteractions)
      .where(
        and(
          eq(agentInteractions.channel, "text"),
          or(isNull(agentInteractions.outcome), ne(agentInteractions.outcome, "not_sent"))
        )
      ),
    db
      .selectDistinct({ agentId: messageSends.agentId })
      .from(messageSends)
      .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
      .where(eq(messagePresets.channel, "sms")),
  ]);

  const lastFromFeed = new Map<string, number>();
  for (const r of fromFeed) if (r.feed && r.at) lastFromFeed.set(`${r.agentId}|${r.feed}`, new Date(r.at).getTime());

  // Replies only matter for agents who've had a feed text.
  const ids = [...new Set(fromFeed.map((r) => r.agentId))];
  const lastIn = new Map<string, number>();
  if (ids.length) {
    const [inbound, responded] = await Promise.all([
      db
        .select({ agentId: agentInteractions.agentId, at: max(agentInteractions.occurredAt) })
        .from(agentInteractions)
        .where(and(eq(agentInteractions.direction, "inbound"), inArray(agentInteractions.agentId, ids)))
        .groupBy(agentInteractions.agentId),
      db
        .select({ agentId: messageSends.agentId, at: max(messageSends.respondedAt) })
        .from(messageSends)
        .where(and(isNotNull(messageSends.respondedAt), inArray(messageSends.agentId, ids)))
        .groupBy(messageSends.agentId),
    ]);
    for (const r of [...inbound, ...responded]) {
      if (!r.agentId || !r.at) continue;
      const t = new Date(r.at).getTime();
      lastIn.set(r.agentId, Math.max(lastIn.get(r.agentId) ?? 0, t));
    }
  }

  return {
    passes: new Set(passes.map((p) => `${p.agentId}|${p.feed}|${p.listingId ?? ""}`)),
    lastFromFeed,
    lastIn,
    texted: new Set([...texts.map((t) => t.agentId), ...smsSends.flatMap((t) => (t.agentId ? [t.agentId] : []))]),
  };
}

/** Whether a card may show in this feed, by the three rules above. */
export function feedAllows(history: FeedHistory, feed: FollowUpFeedKey, item: Pick<FeedItem, "agent" | "listing">): boolean {
  const agentId = item.agent.id;
  if (!EMAIL_OK.has(feed) && !history.texted.has(agentId)) return false;
  if (history.passes.has(`${agentId}|${feed}|`)) return false;
  if (item.listing && history.passes.has(`${agentId}|${feed}|${item.listing.id}`)) return false;

  const sent = history.lastFromFeed.get(`${agentId}|${feed}`);
  if (sent == null) return true;
  if (!REPEAT_AFTER_REPLY.has(feed)) return false;
  return (history.lastIn.get(agentId) ?? 0) > sent;
}
