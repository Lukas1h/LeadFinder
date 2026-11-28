import { and, eq, gte, inArray, lte, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookingLineItems, bookings, listings, shooters } from "@/db/schema";
import type { ShooterRates } from "@/db/schema";
import { computeFunnelSplit } from "@/lib/funnelSplit";
import { UNASSIGNED, editorCost, type Market, type MarketDef, type MarketKind, type MarketStatus } from "@/lib/markets";
import { getMarkets } from "@/lib/marketsData";

/**
 * What the Markets page shows: every market's config (lib/markets.ts) plus
 * how it is doing — leads found, texts sent, jobs booked, money made.
 *
 * Server-only (it reads the database). A page passes the plain objects down to
 * client components; nothing here may be imported by one.
 */

/** The performance window: the last four weeks, for found_at and job_date. */
const WINDOW_DAYS = 28;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A market is "killed" once outreach into it has had a fair trial and the
 * reply rate is still hopeless. A placeholder until there are enough weeks of
 * data to tune it (Lukas) — it only flags the row, nothing is paused by it.
 */
export const KILL_MIN_SENDS = 50;
export const KILL_REPLY_RATE = 0.05;

/** One market's numbers over the window. */
export interface MarketPerformance {
  key: string;
  label: string;
  kind: MarketKind;
  status: MarketStatus;
  launchedAt: string | null;
  /** Whole days since launch; null before it launched. */
  daysLive: number | null;
  /** The window the listing/booking numbers cover (28 days). */
  days: number;
  /** Listings found in the window and placed in this market (mk.marketFor). */
  listingsFound: number;
  /** Listings still open now (status "new" with no booking), as the Leads board counts them. */
  openListings: number;
  /**
   * Cold outreach: agents whose first outreach text went out in the funnel
   * split's window (lib/funnelSplit.ts: FEED_STATS_DAYS, 30 days — kept as-is
   * so the Markets page and the Home card always agree, even though it is a
   * couple of days wider than this row's 28).
   */
  coldSent: number;
  coldReplied: number;
  coldInterested: number;
  /** coldReplied / coldSent; null until anything has been sent. */
  replyRate: number | null;
  /** Bookings with a job_date in the window, placed by the booking's address. */
  bookings: number;
  /** Those bookings' line items, in dollars. */
  revenue: number;
  /** Those bookings' shooter pay plus the editor on HDR shooters' jobs (HDR_EDITOR_COST), in dollars. */
  shooterCost: number;
  /** revenue − shooterCost. */
  margin: number;
  /** coldSent ≥ KILL_MIN_SENDS and replyRate < KILL_REPLY_RATE. */
  killFlag: boolean;
}

/** A shooter row for the page's shooter table: every column, plain data. */
export interface ShooterRow {
  id: string;
  name: string;
  label: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  /** The market they shoot; null = not placed yet. */
  marketKey: string | null;
  role: "main" | "backup";
  lat: number | null;
  lng: number | null;
  freeMinutes: number;
  drivePerHour: number | null;
  /** Flat travel fee by lowercase town, replacing the drive-per-hour estimate there. */
  travelFees: Record<string, number>;
  /** Farthest one-way drive, minutes; null = no limit. */
  maxMinutes: number | null;
  /** "hdr" (Lukas also pays an editor) or "flambient". */
  style: "hdr" | "flambient";
  rates: ShooterRates;
  active: boolean;
  w9OnFile: boolean;
  portfolioPhotos: { src: string; alt: string; credit?: string | null }[];
  createdAt: string;
}

export interface MarketsOverview {
  /** Every market row, any status, in sort order. */
  markets: MarketDef[];
  /** One row per market (any status), in the same order, then `unassigned` separately. */
  performance: MarketPerformance[];
  /** Out-of-state places in no market ("Other"); never regional in the quotas. */
  unassigned: MarketPerformance;
  /** Every shooter on file, active or not, placed or not. */
  shooters: ShooterRow[];
}

/** The Home funnel card's cold numbers, split by market (same numbers as Home). */
const loadColdSplit = computeFunnelSplit;

const EMPTY_COLD = { reached: 0, replied: 0, interested: 0 };

interface Tally {
  listingsFound: number;
  openListings: number;
  bookings: number;
  revenue: number;
  shooterCost: number;
}

const emptyTally = (): Tally => ({ listingsFound: 0, openListings: 0, bookings: 0, revenue: 0, shooterCost: 0 });

export async function loadMarketsOverview(): Promise<MarketsOverview> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);

  // Four reads, placed in JS with the same MarketIndex every other page uses:
  // marketFor is a pile of rules (town list, drive table, point area), and
  // duplicating it in SQL would let the pages disagree about a listing.
  const [mk, coldSplit, foundRows, openRows, bookingRows] = await Promise.all([
    getMarkets(),
    loadColdSplit(),
    db
      .select({
        city: listings.city,
        state: listings.state,
        lat: listings.lat,
        lng: listings.lng,
        geocodeSource: listings.geocodeSource,
      })
      .from(listings)
      .where(gte(listings.foundAt, cutoff)),
    db
      .select({
        city: listings.city,
        state: listings.state,
        lat: listings.lat,
        lng: listings.lng,
        geocodeSource: listings.geocodeSource,
      })
      .from(listings)
      // Exactly the Leads board's "open": still new, and never booked.
      .where(
        and(
          eq(listings.status, "new"),
          notExists(db.select({ one: sql`1` }).from(bookings).where(eq(bookings.listingId, listings.id)))
        )
      ),
    db
      .select({
        id: bookings.id,
        // A booking's place is its listing's when it has one, as bookingPlace
        // (lib/airspace.ts) resolves it.
        city: sql<string | null>`coalesce(${listings.city}, ${bookings.city})`,
        state: sql<string | null>`coalesce(${listings.state}, ${bookings.state})`,
        lat: sql<number | null>`coalesce(${listings.lat}, ${bookings.lat})`,
        lng: sql<number | null>`coalesce(${listings.lng}, ${bookings.lng})`,
        geocodeSource: sql<string | null>`coalesce(${listings.geocodeSource}, ${bookings.geocodeSource})`,
        shooterPay: sql<number>`coalesce(${bookings.shooterPay}, 0)::int`,
        shooterStyle: shooters.style,
        editorCost: bookings.editorCost,
      })
      .from(bookings)
      .leftJoin(listings, eq(listings.id, bookings.listingId))
      .leftJoin(shooters, eq(shooters.id, bookings.shooterId))
      .where(and(gte(bookings.jobDate, cutoff), lte(bookings.jobDate, now))),
  ]);

  const tally = new Map<Market, Tally>(mk.keys.map((key) => [key, emptyTally()]));

  for (const row of foundRows) tally.get(mk.marketFor(row))!.listingsFound++;
  for (const row of openRows) tally.get(mk.marketFor(row))!.openListings++;

  const revenueByBooking = new Map<string, number>();
  if (bookingRows.length > 0) {
    const sums = await db
      .select({
        bookingId: bookingLineItems.bookingId,
        total: sql<number>`coalesce(sum(${bookingLineItems.amount}), 0)::int`,
      })
      .from(bookingLineItems)
      .where(inArray(bookingLineItems.bookingId, bookingRows.map((r) => r.id)))
      .groupBy(bookingLineItems.bookingId);
    for (const row of sums) revenueByBooking.set(row.bookingId, Number(row.total));
  }

  for (const row of bookingRows) {
    const entry = tally.get(mk.marketFor(row))!;
    entry.bookings++;
    entry.revenue += revenueByBooking.get(row.id) ?? 0;
    // A contracted HDR shoot also pays an editor; flambient Lukas blends himself.
    entry.shooterCost += Number(row.shooterPay) + (row.shooterStyle ? editorCost(row.shooterStyle, row.editorCost) : 0);
  }

  const toPerformance = (
    key: string,
    label: string,
    kind: MarketKind,
    status: MarketStatus,
    launchedAt: string | null
  ): MarketPerformance => {
    const t = tally.get(key) ?? emptyTally();
    const cold = coldSplit.byMarket[key]?.cold ?? EMPTY_COLD;
    const replyRate = cold.reached > 0 ? cold.replied / cold.reached : null;
    return {
      key,
      label,
      kind,
      status,
      launchedAt,
      daysLive: launchedAt == null ? null : Math.max(0, Math.floor((now.getTime() - Date.parse(launchedAt)) / DAY_MS)),
      days: WINDOW_DAYS,
      listingsFound: t.listingsFound,
      openListings: t.openListings,
      coldSent: cold.reached,
      coldReplied: cold.replied,
      coldInterested: cold.interested,
      replyRate,
      bookings: t.bookings,
      revenue: t.revenue,
      shooterCost: t.shooterCost,
      margin: t.revenue - t.shooterCost,
      killFlag: cold.reached >= KILL_MIN_SENDS && replyRate != null && replyRate < KILL_REPLY_RATE,
    };
  };

  const performance = mk.all.map((m) => toPerformance(m.key, m.label, m.kind, m.status, m.launchedAt));

  // "Other" is a virtual row, so it has no kind or status of its own; it is
  // his own (driven-to) side of the business, and the key tells the page it is
  // the unassigned bucket.
  const unassigned = toPerformance(UNASSIGNED, mk.labels[UNASSIGNED], "regional", "active", null);

  const shooterRows = await db
    .select({
      id: shooters.id,
      name: shooters.name,
      label: shooters.label,
      phone: shooters.phone,
      email: shooters.email,
      notes: shooters.notes,
      marketKey: shooters.marketKey,
      role: shooters.role,
      lat: shooters.lat,
      lng: shooters.lng,
      freeMinutes: shooters.freeMinutes,
      drivePerHour: shooters.drivePerHour,
      travelFees: shooters.travelFees,
      maxMinutes: shooters.maxMinutes,
      style: shooters.style,
      rates: shooters.rates,
      active: shooters.active,
      w9OnFile: shooters.w9OnFile,
      portfolioPhotos: shooters.portfolioPhotos,
      createdAt: shooters.createdAt,
    })
    .from(shooters)
    .orderBy(shooters.name);

  return {
    markets: [...mk.all],
    performance,
    unassigned,
    shooters: shooterRows.map((s) => ({
      ...s,
      role: s.role === "backup" ? "backup" : "main",
      style: s.style === "flambient" ? "flambient" : "hdr",
      travelFees: s.travelFees ?? {},
      rates: s.rates ?? {},
      portfolioPhotos: s.portfolioPhotos ?? [],
      createdAt: s.createdAt.toISOString(),
    })),
  };
}
