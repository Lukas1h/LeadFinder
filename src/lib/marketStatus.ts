// The nightly market check: what has happened to the listings of agents Lukas
// knows since he last looked.
//
// A listing going under contract or closing is the best excuse there is to
// text an agent who already knows him — "congrats on Maple St!" is a message
// nobody minds getting, and it puts him back in mind right when they're about
// to list again. A one-off run of this on 2026-10-08 turned up nine pendings
// among 74 listings, none of which the app knew about, because Zillow alerts
// only ever tell it about new listings.
//
// Compass is the source (see lib/compass.ts): free, and it answers plain
// fetches. Only agents he knows are checked, which keeps a run to a couple of
// hundred requests.

import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { fetchCompassStatus } from "@/lib/compass";

const DAY = 24 * 60 * 60 * 1000;

/** Listings older than this aren't worth asking about any more. */
const TRACK_DAYS = 270;
/** Once a day is plenty; this also lets a second run the same day pick up where the first stopped. */
const RECHECK_HOURS = 20;
const CONCURRENCY = 4;

export type MarketNews = "under_contract" | "pending" | "sold";

/**
 * Whether a market status is something to congratulate an agent on, and which
 * kind. The three are kept apart because agents use the words precisely:
 * "pending" only when the MLS status is Pending, "under contract" for anything
 * else with an accepted offer (contingent, bumpable, active under contract),
 * and never "sold" before it has closed.
 */
export function marketNews(status: string | null | undefined): MarketNews | null {
  if (!status) return null;
  if (/\b(sold|closed)\b/i.test(status)) return "sold";
  if (/\bpending\b/i.test(status)) return "pending";
  if (/under contract|contingent|bumpable/i.test(status)) return "under_contract";
  return null;
}

/** "Pending since Oct 5", "Under contract since Oct 5", "Sold Oct 5" — Pacific time. */
export function marketNewsLabel(kind: MarketNews, at: Date | null): string {
  const date = at
    ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })
    : null;
  if (kind === "sold") return date ? `Sold ${date}` : "Sold";
  const word = kind === "pending" ? "Pending" : "Under contract";
  return date ? `${word} since ${date}` : word;
}

export interface MarketCheckResult {
  checked: number;
  found: number;
  changed: { address: string | null; from: string | null; to: string }[];
}

/**
 * Asks Compass where each tracked listing stands and stores it. Listings are
 * taken longest-unchecked first, so a run that is cut short just leaves the
 * rest for the next one. Already-sold listings are left alone.
 */
export async function refreshMarketStatuses(limit = 200): Promise<MarketCheckResult> {
  const now = Date.now();
  const rows = await db
    .select({
      id: listings.id,
      address: listings.address,
      city: listings.city,
      listedAt: listings.listedAt,
      foundAt: listings.foundAt,
      marketStatus: listings.marketStatus,
    })
    .from(listings)
    .innerJoin(agents, eq(listings.agentId, agents.id))
    .where(
      and(
        inArray(agents.relationshipStatus, ["regular", "worked_once", "interested", "warm"]),
        isNotNull(listings.address),
        isNotNull(listings.city),
        gt(listings.foundAt, new Date(now - TRACK_DAYS * DAY)),
        or(isNull(listings.marketCheckedAt), lt(listings.marketCheckedAt, new Date(now - RECHECK_HOURS * 60 * 60 * 1000))),
        or(isNull(listings.marketStatus), sql`${listings.marketStatus} !~* '\\m(sold|closed)\\M'`)
      )
    )
    .orderBy(sql`${listings.marketCheckedAt} asc nulls first`)
    .limit(limit);

  const result: MarketCheckResult = { checked: 0, found: 0, changed: [] };
  const queue = [...rows];

  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const compass = await fetchCompassStatus(row);
      result.checked++;
      const update: { marketCheckedAt: Date; marketStatus?: string; marketStatusAt?: Date | null } = {
        marketCheckedAt: new Date(),
      };

      if (compass) {
        result.found++;
        const kind = marketNews(compass.status);
        const eventAt = kind === "sold" ? compass.closedAt ?? compass.contractAt : kind ? compass.contractAt : null;
        // Compass shows whatever it last had at the address, which for a home
        // it hasn't picked up the new listing for is the previous sale, years
        // back. A contract or closing from before this listing existed is
        // that, not news.
        const listingStart = (row.listedAt ?? row.foundAt).getTime() - 3 * DAY;
        const stale = kind != null && eventAt != null && eventAt.getTime() < listingStart;

        if (!stale && compass.status !== row.marketStatus) {
          update.marketStatus = compass.status;
          // No date on the page: it changed sometime since the last check.
          update.marketStatusAt = kind ? eventAt ?? new Date() : null;
          result.changed.push({ address: row.address, from: row.marketStatus, to: compass.status });
        }
      }

      await db.update(listings).set(update).where(eq(listings.id, row.id));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return result;
}
