// The nightly market check: what has happened to the listings of agents Lukas
// knows, and to the homes he has shot, since he last looked.
//
// A listing going under contract or closing is the best excuse there is to
// text an agent who already knows him — "congrats on Maple St!" is a message
// nobody minds getting, and it puts him back in mind right when they're about
// to list again. A one-off run of this on 2026-10-08 turned up nine pendings
// among 74 listings, none of which the app knew about, because Zillow alerts
// only ever tell it about new listings. For a home he photographed it's better
// still: one of his went pending the day after the photos went up.
//
// Compass is the source (see lib/compass.ts): free, and it answers plain
// fetches. Only agents he knows and his own jobs are checked, which keeps a
// run to a couple of hundred requests.

import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, bookings, listings } from "@/db/schema";
import { fetchCompassStatus } from "@/lib/compass";

const DAY = 24 * 60 * 60 * 1000;

/** Listings (and jobs) older than this aren't worth asking about any more. */
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

interface Tracked {
  address: string | null;
  city: string | null;
  /** When this listing or job began: a contract or closing from before it is an earlier sale of the same house. */
  since: Date;
  marketStatus: string | null;
}

interface MarketUpdate {
  marketCheckedAt: Date;
  marketStatus?: string;
  marketStatusAt?: Date | null;
  marketNoticedAt?: Date | null;
}

/** Asks Compass about one address and works out what to store, or just the check time if nothing changed. */
async function check(row: Tracked, result: MarketCheckResult): Promise<MarketUpdate> {
  const compass = await fetchCompassStatus(row);
  result.checked++;
  const update: MarketUpdate = { marketCheckedAt: new Date() };
  if (!compass) return update;

  result.found++;
  const kind = marketNews(compass.status);
  const eventAt = kind === "sold" ? compass.closedAt ?? compass.contractAt : kind ? compass.contractAt : null;
  // Compass shows whatever it last had at the address, which for a home it
  // hasn't picked up the new listing for is the previous sale, years back.
  const stale = kind != null && eventAt != null && eventAt.getTime() < row.since.getTime() - 3 * DAY;

  if (!stale && compass.status !== row.marketStatus) {
    update.marketStatus = compass.status;
    // No date on the page: it changed sometime since the last check.
    update.marketStatusAt = kind ? eventAt ?? new Date() : null;
    update.marketNoticedAt = kind ? new Date() : null;
    result.changed.push({ address: row.address, from: row.marketStatus, to: compass.status });
  }
  return update;
}

/**
 * Asks Compass where each tracked listing and each recent job stands and stores
 * it. Rows are taken longest-unchecked first, so a run that is cut short just
 * leaves the rest for the next one. Anything already sold is left alone.
 */
export async function refreshMarketStatuses(limit = 200): Promise<MarketCheckResult> {
  const now = Date.now();
  const tracked = new Date(now - TRACK_DAYS * DAY);
  const recheck = new Date(now - RECHECK_HOURS * 60 * 60 * 1000);
  const notSold = (column: typeof listings.marketStatus | typeof bookings.marketStatus) =>
    or(isNull(column), sql`${column} !~* '\\m(sold|closed)\\M'`);

  const [listingRows, bookingRows] = await Promise.all([
    db
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
          gt(listings.foundAt, tracked),
          or(isNull(listings.marketCheckedAt), lt(listings.marketCheckedAt, recheck)),
          notSold(listings.marketStatus)
        )
      )
      .orderBy(sql`${listings.marketCheckedAt} asc nulls first`)
      .limit(limit),
    // His own jobs, by the listing's address when there is one and the
    // booking's own otherwise. Future jobs aren't on the market yet.
    db
      .select({
        id: bookings.id,
        address: sql<string | null>`coalesce(${listings.address}, ${bookings.address})`,
        city: sql<string | null>`coalesce(${listings.city}, ${bookings.city})`,
        jobDate: bookings.jobDate,
        createdAt: bookings.createdAt,
        marketStatus: bookings.marketStatus,
      })
      .from(bookings)
      .leftJoin(listings, eq(bookings.listingId, listings.id))
      .where(
        and(
          gt(bookings.createdAt, tracked),
          or(isNull(bookings.jobDate), lt(bookings.jobDate, new Date(now))),
          or(isNull(bookings.marketCheckedAt), lt(bookings.marketCheckedAt, recheck)),
          notSold(bookings.marketStatus)
        )
      )
      .orderBy(sql`${bookings.marketCheckedAt} asc nulls first`)
      .limit(limit),
  ]);

  const result: MarketCheckResult = { checked: 0, found: 0, changed: [] };
  const jobs: (() => Promise<void>)[] = [
    ...bookingRows
      .filter((b) => b.address && b.city)
      .map((b) => async () => {
        const update = await check({ ...b, since: b.jobDate ?? b.createdAt }, result);
        await db.update(bookings).set(update).where(eq(bookings.id, b.id));
      }),
    ...listingRows.map((l) => async () => {
      const update = await check({ ...l, since: l.listedAt ?? l.foundAt }, result);
      await db.update(listings).set(update).where(eq(listings.id, l.id));
    }),
  ];

  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) await job();
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return result;
}
