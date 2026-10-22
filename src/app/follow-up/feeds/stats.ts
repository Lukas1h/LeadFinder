import { db } from "@/db";
import { agentInteractions, messageSends } from "@/db/schema";
import { and, gt, inArray, isNotNull } from "drizzle-orm";

const DAY = 24 * 60 * 60 * 1000;
/** The window each feed is judged on. */
export const FEED_STATS_DAYS = 30;
/** A reply this soon after a feed's text counts as the feed's. */
const REPLY_WITHIN_DAYS = 7;

export interface FeedStats {
  /** Agents texted or called from this feed in the window. */
  reached: number;
  /** Of those, how many answered within REPLY_WITHIN_DAYS. */
  replied: number;
}

/**
 * How each feed is doing, from the calls and texts started on its cards
 * (agentInteractions.followUpFeed, recorded since 2026-10-21). A reply is an
 * inbound call/text/email, or a send marked responded, within a week of it.
 */
export async function getFeedStats(): Promise<Map<string, FeedStats>> {
  // Request-time rendering is already established by getOfferFeeds before this runs.
  const since = new Date(Date.now() - FEED_STATS_DAYS * DAY);
  const starts = await db
    .select({ agentId: agentInteractions.agentId, feed: agentInteractions.followUpFeed, at: agentInteractions.occurredAt })
    .from(agentInteractions)
    .where(and(isNotNull(agentInteractions.followUpFeed), gt(agentInteractions.occurredAt, since)));
  const stats = new Map<string, FeedStats>();
  if (starts.length === 0) return stats;

  const ids = [...new Set(starts.map((s) => s.agentId))];
  const [inbound, responded] = await Promise.all([
    db
      .select({ agentId: agentInteractions.agentId, at: agentInteractions.occurredAt, direction: agentInteractions.direction })
      .from(agentInteractions)
      .where(and(inArray(agentInteractions.agentId, ids), gt(agentInteractions.occurredAt, since))),
    db
      .select({ agentId: messageSends.agentId, at: messageSends.respondedAt })
      .from(messageSends)
      .where(and(inArray(messageSends.agentId, ids), gt(messageSends.respondedAt, since))),
  ]);
  const replies = new Map<string, number[]>();
  const add = (id: string | null, at: Date | null) => {
    if (!id || !at) return;
    replies.set(id, [...(replies.get(id) ?? []), at.getTime()]);
  };
  for (const i of inbound) if (i.direction === "inbound") add(i.agentId, i.at);
  for (const r of responded) add(r.agentId, r.at);

  // One per agent per feed: the first time they were reached from it in the window.
  const first = new Map<string, { feed: string; agentId: string; at: number }>();
  for (const s of starts) {
    const key = `${s.feed}|${s.agentId}`;
    const at = s.at.getTime();
    if (!first.has(key) || at < first.get(key)!.at) first.set(key, { feed: s.feed!, agentId: s.agentId, at });
  }
  for (const { feed, agentId, at } of first.values()) {
    const entry = stats.get(feed) ?? { reached: 0, replied: 0 };
    entry.reached++;
    if ((replies.get(agentId) ?? []).some((t) => t > at && t < at + REPLY_WITHIN_DAYS * DAY)) entry.replied++;
    stats.set(feed, entry);
  }
  return stats;
}
