import { db } from "@/db";
import { agentInteractions, agentStatusChanges, agents, messageSends } from "@/db/schema";
import { and, gt, inArray, isNotNull } from "drizzle-orm";

const DAY = 24 * 60 * 60 * 1000;
/** The window each feed is judged on. */
export const FEED_STATS_DAYS = 30;
/** A reply this soon after a feed's text counts as the feed's. */
const REPLY_WITHIN_DAYS = 7;
/** Statuses that count as "turned interested" (a booking skips straight past it). */
const INTERESTED_OR_BETTER = new Set(["interested", "worked_once", "regular"]);

export interface FeedStats {
  /** Agents texted or called from this feed in the window. */
  reached: number;
  /** Of those, how many answered within REPLY_WITHIN_DAYS. */
  replied: number;
  /** Of those reached, how many were warm at the time. */
  warm: number;
  /** Of the warm ones, how many have turned interested (or booked) since. */
  converted: number;
}

const empty = (): FeedStats => ({ reached: 0, replied: 0, warm: 0, converted: 0 });

/**
 * How each feed is doing, from the calls and texts started on its cards
 * (agentInteractions.followUpFeed, recorded since 2026-10-21), plus `all`:
 * every agent reached from any feed, once (the Home funnel's Follow up row).
 *
 * A reply is an inbound call/text/email, or a send marked responded, within a
 * week of it. Warm → interested comes from agent_status_changes (a trigger,
 * since 2026-11-09): an agent was warm when reached if the first status change
 * after the reach starts from warm, or there's been none and they're warm now;
 * converted if a change after the reach went from warm to interested or better.
 */
export async function getFeedStatsWithTotal(): Promise<{ byFeed: Map<string, FeedStats>; all: FeedStats }> {
  const since = new Date(Date.now() - FEED_STATS_DAYS * DAY);
  const starts = await db
    .select({
      agentId: agentInteractions.agentId,
      feed: agentInteractions.followUpFeed,
      at: agentInteractions.occurredAt,
      outcome: agentInteractions.outcome,
    })
    .from(agentInteractions)
    .where(and(isNotNull(agentInteractions.followUpFeed), gt(agentInteractions.occurredAt, since)));
  const byFeed = new Map<string, FeedStats>();
  const all = empty();
  const reachedStarts = starts.filter((s) => s.outcome !== "not_sent");
  if (reachedStarts.length === 0) return { byFeed, all };

  const ids = [...new Set(reachedStarts.map((s) => s.agentId))];
  const [inbound, responded, changes, current] = await Promise.all([
    db
      .select({ agentId: agentInteractions.agentId, at: agentInteractions.occurredAt, direction: agentInteractions.direction })
      .from(agentInteractions)
      .where(and(inArray(agentInteractions.agentId, ids), gt(agentInteractions.occurredAt, since))),
    db
      .select({ agentId: messageSends.agentId, at: messageSends.respondedAt })
      .from(messageSends)
      .where(and(inArray(messageSends.agentId, ids), gt(messageSends.respondedAt, since))),
    db
      .select({
        agentId: agentStatusChanges.agentId,
        from: agentStatusChanges.fromStatus,
        to: agentStatusChanges.toStatus,
        at: agentStatusChanges.changedAt,
      })
      .from(agentStatusChanges)
      .where(and(inArray(agentStatusChanges.agentId, ids), gt(agentStatusChanges.changedAt, since))),
    db.select({ id: agents.id, status: agents.relationshipStatus }).from(agents).where(inArray(agents.id, ids)),
  ]);

  const replies = new Map<string, number[]>();
  const add = (id: string | null, at: Date | null) => {
    if (!id || !at) return;
    replies.set(id, [...(replies.get(id) ?? []), at.getTime()]);
  };
  for (const i of inbound) if (i.direction === "inbound") add(i.agentId, i.at);
  for (const r of responded) add(r.agentId, r.at);

  const changesBy = new Map<string, { from: string | null; to: string; at: number }[]>();
  for (const c of changes) {
    const list = changesBy.get(c.agentId) ?? [];
    list.push({ from: c.from, to: c.to, at: c.at.getTime() });
    changesBy.set(c.agentId, list);
  }
  for (const list of changesBy.values()) list.sort((a, b) => a.at - b.at);
  const statusNow = new Map(current.map((a) => [a.id, a.status as string]));

  const tally = (entry: FeedStats, agentId: string, at: number) => {
    entry.reached++;
    if ((replies.get(agentId) ?? []).some((t) => t > at && t < at + REPLY_WITHIN_DAYS * DAY)) entry.replied++;
    const after = (changesBy.get(agentId) ?? []).filter((c) => c.at > at);
    const wasWarm = after.length > 0 ? after[0].from === "warm" : statusNow.get(agentId) === "warm";
    if (!wasWarm) return;
    entry.warm++;
    if (after.some((c) => c.from === "warm" && INTERESTED_OR_BETTER.has(c.to))) entry.converted++;
  };

  // One per agent per feed: the first time they were reached from it in the window.
  const first = new Map<string, { feed: string; agentId: string; at: number }>();
  const firstAny = new Map<string, number>();
  for (const s of reachedStarts) {
    const key = `${s.feed}|${s.agentId}`;
    const at = s.at.getTime();
    if (!first.has(key) || at < first.get(key)!.at) first.set(key, { feed: s.feed!, agentId: s.agentId, at });
    if (!firstAny.has(s.agentId) || at < firstAny.get(s.agentId)!) firstAny.set(s.agentId, at);
  }
  for (const { feed, agentId, at } of first.values()) {
    const entry = byFeed.get(feed) ?? empty();
    tally(entry, agentId, at);
    byFeed.set(feed, entry);
  }
  for (const [agentId, at] of firstAny) tally(all, agentId, at);
  return { byFeed, all };
}

/** Per feed only, for the Follow Up page. */
export async function getFeedStats(): Promise<Map<string, FeedStats>> {
  return (await getFeedStatsWithTotal()).byFeed;
}
