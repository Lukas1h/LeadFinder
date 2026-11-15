import { db } from "@/db";
import { agentInteractions, agentStatusChanges, agents, messageSends } from "@/db/schema";
import { agentMarkets } from "@/lib/agentMarket";
import type { Market } from "@/lib/markets";
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

/** `empty()`, one entry per market — the shape the Home funnel's market tabs want. */
const emptyByMarket = (): Record<Market, FeedStats> => ({
  local: empty(),
  regional: empty(),
  portland: empty(),
});

/** The cold follow-up tabs' feeds (COLD_FEED_KEYS in lib/coldFollowUp/pool.ts). */
const COLD_PREFIX = "cold_";
const isColdFeed = (feed: string | null): boolean => (feed ?? "").startsWith(COLD_PREFIX);

/** A status change into one of these, after a cold reach, is a conversion. */
const CONVERTED_TO = new Set(["warm", ...INTERESTED_OR_BETTER]);
/**
 * Where a change after a cold reach can start and still be a move up: cold
 * itself, or ignored — a cold agent who never answered, which the nightly
 * skip (lib/coldFollowUp/ignore.ts) writes and a reply then clears to warm.
 */
const COLD_STATUSES = new Set(["cold", "ignored"]);

/**
 * How each feed is doing, from the calls and texts started on its cards
 * (agentInteractions.followUpFeed, recorded since 2026-10-21), plus:
 *
 * - `all`: every agent reached from a regular (non-cold) feed, once — the Home
 *   funnel's Follow up row. `allByMarket`: the same tally split by the market
 *   each agent is in (lib/agentMarket.ts). Summing `allByMarket` gives `all`
 *   back.
 * - `allCold` / `allColdByMarket`: the same two, over the cold follow-up feeds
 *   only (`follow_up_feed` starting "cold_": cold_new_listing, cold_near_shoot,
 *   cold_in_area). They sit apart from `all` because a second text to someone
 *   who never answered the first is not comparable to a Follow up card, and
 *   what one is worth is unknown. Still one per agent, the first cold reach in
 *   the window.
 *
 * `byFeed` keeps every feed, cold ones included, so each cold tab shows its own
 * numbers. A reply is an inbound call/text/email, or a send marked responded,
 * within a week of it. Warm → interested comes from agent_status_changes (a
 * trigger, since 2026-11-09): an agent was warm when reached if the first status
 * change after the reach starts from warm, or there's been none and they're warm
 * now; converted if a change after the reach went from warm to interested or
 * better. On a cold row `warm` stays 0 — those agents never answered the first
 * text, so they were cold when reached — and `converted` is any move up from
 * cold (or ignored) after the reach instead: to warm (a reply), interested,
 * worked_once or regular.
 */
export async function getFeedStatsWithTotal(): Promise<{
  byFeed: Map<string, FeedStats>;
  all: FeedStats;
  allByMarket: Record<Market, FeedStats>;
  allCold: FeedStats;
  allColdByMarket: Record<Market, FeedStats>;
}> {
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
  const allByMarket = emptyByMarket();
  const allCold = empty();
  const allColdByMarket = emptyByMarket();
  const reachedStarts = starts.filter((s) => s.outcome !== "not_sent");
  if (reachedStarts.length === 0) return { byFeed, all, allByMarket, allCold, allColdByMarket };

  const ids = [...new Set(reachedStarts.map((s) => s.agentId))];
  const [inbound, responded, changes, current, markets] = await Promise.all([
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
    agentMarkets(ids),
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

  const tally = (entry: FeedStats, agentId: string, at: number, cold = false) => {
    entry.reached++;
    if ((replies.get(agentId) ?? []).some((t) => t > at && t < at + REPLY_WITHIN_DAYS * DAY)) entry.replied++;
    const after = (changesBy.get(agentId) ?? []).filter((c) => c.at > at);
    if (cold) {
      // Reached cold, so there's no "warm when reached" to count; a conversion
      // is a move up from cold after the text — to warm (a reply), interested,
      // worked_once or regular. Ignored counts as cold here: those agents were
      // cold when texted, and the skip only ever ran after the cold follow-up.
      if (after.some((c) => (c.from === null || COLD_STATUSES.has(c.from)) && CONVERTED_TO.has(c.to))) {
        entry.converted++;
      }
      return;
    }
    const wasWarm = after.length > 0 ? after[0].from === "warm" : statusNow.get(agentId) === "warm";
    if (!wasWarm) return;
    entry.warm++;
    if (after.some((c) => c.from === "warm" && INTERESTED_OR_BETTER.has(c.to))) entry.converted++;
  };

  // One per agent per feed: the first time they were reached from it in the window.
  const first = new Map<string, { feed: string; agentId: string; at: number }>();
  const firstAny = new Map<string, number>();
  const firstAnyCold = new Map<string, number>();
  for (const s of reachedStarts) {
    const key = `${s.feed}|${s.agentId}`;
    const at = s.at.getTime();
    if (!first.has(key) || at < first.get(key)!.at) first.set(key, { feed: s.feed!, agentId: s.agentId, at });
    // `all` is the regular feeds only; the cold ones are tallied apart.
    const any = isColdFeed(s.feed) ? firstAnyCold : firstAny;
    if (!any.has(s.agentId) || at < any.get(s.agentId)!) any.set(s.agentId, at);
  }
  for (const { feed, agentId, at } of first.values()) {
    const entry = byFeed.get(feed) ?? empty();
    tally(entry, agentId, at, isColdFeed(feed));
    byFeed.set(feed, entry);
  }
  const tallyAll = (
    total: FeedStats,
    totalByMarket: Record<Market, FeedStats>,
    reached: Map<string, number>,
    cold: boolean
  ) => {
    for (const [agentId, at] of reached) {
      tally(total, agentId, at, cold);
      // agentMarkets gives every id a market; regional only catches an id with
      // no agents row at all, so the buckets always add back up to the total.
      tally(totalByMarket[markets.get(agentId) ?? "regional"], agentId, at, cold);
    }
  };
  tallyAll(all, allByMarket, firstAny, false);
  tallyAll(allCold, allColdByMarket, firstAnyCold, true);
  return { byFeed, all, allByMarket, allCold, allColdByMarket };
}

/** Per feed only, for the Follow Up page. */
export async function getFeedStats(): Promise<Map<string, FeedStats>> {
  return (await getFeedStatsWithTotal()).byFeed;
}
