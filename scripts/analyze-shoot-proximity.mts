/**
 * How close is "near"? Measures the distance from every shoot to every other
 * listing on file, so a radius for "I just shot a home near your listing" can
 * be picked from real data rather than a guess.
 *
 *   npx tsx --env-file=.env.local scripts/analyze-shoot-proximity.mts
 *
 * Read-only: only SELECTs, and writes exports/geocode/proximity-pairs.csv.
 *
 * A booking's point is its own lat/lng when it has one, else the linked
 * listing's (a booking made against a tracked listing usually has none of its
 * own). Listings at the booking's own address, and the booking's linked
 * listing itself, are never counted as "nearby" — that's the home he just shot.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  bookings,
  listings,
  type AgentRelationshipStatus,
  type Listing,
} from "@/db/schema";
import { stillActive } from "@/app/follow-up/feeds/shared";

const EARTH_RADIUS_MILES = 3_958.7613;
const MAX_MILES = 5;
const EXPORT_PATH = resolve("exports/geocode/proximity-pairs.csv");

/** Agent statuses that count as an existing relationship worth trading on. */
const WARM_STATUSES: ReadonlySet<string> = new Set([
  "warm",
  "interested",
  "regular",
  "worked_once",
]);

interface Band {
  label: string;
  maxMiles: number;
}

const BANDS: Band[] = [
  { label: "<0.25", maxMiles: 0.25 },
  { label: "0.25-0.5", maxMiles: 0.5 },
  { label: "0.5-1", maxMiles: 1 },
  { label: "1-2", maxMiles: 2 },
  { label: "2-3", maxMiles: 3 },
  { label: "3-5", maxMiles: 5 },
];

/** The radii the per-booking table counts at. */
const THRESHOLDS = [0.5, 1, 2, 5];

interface Shoot {
  id: string;
  address: string;
  city: string;
  jobDate: Date | null;
  shot: boolean;
  lat: number;
  lng: number;
  contactAgentId: string | null;
  ownListingId: string | null;
  /** Lowercased, non-alphanumerics stripped — for the "same home" check. */
  addressKey: string;
}

interface NearbyListing {
  listing: Listing;
  lat: number;
  lng: number;
  agentName: string | null;
  agentStatus: AgentRelationshipStatus | null;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

function addressKey(address: string | null | undefined): string {
  return (address ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function bandFor(miles: number): number {
  return BANDS.findIndex((b, i) => miles < b.maxMiles || (i === BANDS.length - 1 && miles <= b.maxMiles));
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

async function loadShoots(): Promise<{ shoots: Shoot[]; total: number; noPoint: number }> {
  const rows = await db
    .select({
      booking: bookings,
      listingAddress: listings.address,
      listingCity: listings.city,
      listingLat: listings.lat,
      listingLng: listings.lng,
    })
    .from(bookings)
    .leftJoin(listings, eq(bookings.listingId, listings.id));

  const shoots: Shoot[] = [];
  for (const row of rows) {
    const b = row.booking;
    const lat = b.lat ?? row.listingLat;
    const lng = b.lng ?? row.listingLng;
    if (lat == null || lng == null) continue;

    const address = b.address ?? row.listingAddress ?? "";
    shoots.push({
      id: b.id,
      address,
      city: b.city ?? row.listingCity ?? "",
      jobDate: b.jobDate,
      shot: Boolean(b.shotAt ?? b.completedAt ?? b.invoicedAt ?? b.invoiceSentAt ?? b.paidAt),
      lat,
      lng,
      contactAgentId: b.contactAgentId,
      ownListingId: b.listingId,
      addressKey: addressKey(address),
    });
  }

  return { shoots, total: rows.length, noPoint: rows.length - shoots.length };
}

async function loadListings(): Promise<NearbyListing[]> {
  const rows = await db
    .select({
      listing: listings,
      agentName: agents.name,
      agentStatus: agents.relationshipStatus,
    })
    .from(listings)
    .leftJoin(agents, eq(listings.agentId, agents.id))
    .where(and(isNotNull(listings.lat), isNotNull(listings.lng)));

  const out: NearbyListing[] = [];
  for (const row of rows) {
    if (row.listing.lat == null || row.listing.lng == null) continue;
    out.push({
      listing: row.listing,
      lat: row.listing.lat,
      lng: row.listing.lng,
      agentName: row.agentName,
      agentStatus: row.agentStatus,
    });
  }
  return out;
}

interface Totals {
  bookingsTotal: number;
  bookingsTried: number;
  listingsTotal: number;
  listingsTried: number;
}

/** Row counts, so a backfill still in flight is visible in the coverage report. */
async function loadTotals(): Promise<Totals> {
  const [b] = await db
    .select({
      total: sql<number>`count(*)::int`,
      tried: sql<number>`count(*) filter (where ${bookings.geocodedAt} is not null)::int`,
    })
    .from(bookings);
  const [l] = await db
    .select({
      total: sql<number>`count(*)::int`,
      tried: sql<number>`count(*) filter (where ${listings.geocodedAt} is not null)::int`,
    })
    .from(listings);
  return {
    bookingsTotal: b.total,
    bookingsTried: b.tried,
    listingsTotal: l.total,
    listingsTried: l.tried,
  };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

interface BandStats {
  pairs: number;
  activePairs: number;
  /** Agent id -> relationship status, for eligible (active, non-declined, other-agent) pairs. */
  agents: Map<string, string | null>;
}

interface BookingStats {
  shoot: Shoot;
  /** Eligible (active, non-declined, other-agent) listing counts by threshold. */
  counts: Map<number, number>;
  /** All listings of any status within 1 mile. */
  density: number;
}

interface PairRow {
  shoot: Shoot;
  near: NearbyListing;
  miles: number;
  active: boolean;
  sameAgent: boolean;
}

function isEligible(near: NearbyListing, shoot: Shoot): boolean {
  if (near.agentStatus === "declined") return false;
  if (near.listing.agentId == null) return false;
  if (shoot.contactAgentId != null && near.listing.agentId === shoot.contactAgentId) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function pad(value: string, width: number): string {
  return value.length > width ? value.slice(0, Math.max(0, width - 1)) + "…" : value.padEnd(width);
}

function padLeft(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value.padStart(width);
}

function dateLabel(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function meter(value: number, max: number): string {
  const width = 28;
  const filled = Math.round((Math.min(value, max) / max) * width);
  return "#".repeat(filled) + "·".repeat(width - filled);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [{ shoots, total: bookingTotal, noPoint }, nearby, totals] = await Promise.all([
    loadShoots(),
    loadListings(),
    loadTotals(),
  ]);

  console.log("Shoot proximity — how close is \"near\"?\n");

  // (a) Coverage -------------------------------------------------------------
  console.log("Coverage");
  console.log(
    `  bookings: ${bookingTotal} total, ${shoots.length} with a point (own or linked listing), ` +
      `${noPoint} without (${totals.bookingsTried} looked up by the geocoder)`
  );
  console.log(
    `  listings: ${totals.listingsTotal} total, ${nearby.length} with a point ` +
      `(${totals.listingsTried} looked up by the geocoder)`
  );
  const unaddressed = shoots.filter((s) => s.addressKey === "").length;
  if (unaddressed > 0) {
    console.log(`  bookings with a point but no address to compare: ${unaddressed} (only their linked listing is excluded)`);
  }
  console.log("");

  // Compute every pair once --------------------------------------------------
  const bandStats: BandStats[] = BANDS.map(() => ({ pairs: 0, activePairs: 0, agents: new Map() }));
  const bookingStats: BookingStats[] = [];
  const pairs: PairRow[] = [];

  for (const shoot of shoots) {
    const stats: BookingStats = {
      shoot,
      counts: new Map(THRESHOLDS.map((t) => [t, 0])),
      density: 0,
    };

    for (const near of nearby) {
      if (near.listing.id === shoot.ownListingId) continue;
      const nearKey = addressKey(near.listing.address);
      if (shoot.addressKey !== "" && nearKey !== "" && nearKey === shoot.addressKey) continue;

      const miles = milesBetween(shoot.lat, shoot.lng, near.lat, near.lng);
      if (miles <= 1) stats.density++;

      if (miles > MAX_MILES) continue;

      const active = stillActive(near.listing);
      const sameAgent = shoot.contactAgentId != null && near.listing.agentId === shoot.contactAgentId;
      pairs.push({ shoot, near, miles, active, sameAgent });

      const band = bandFor(miles);
      if (band >= 0) {
        const bs = bandStats[band];
        bs.pairs++;
        if (active) bs.activePairs++;
        if (active && near.listing.agentId != null && !sameAgent && near.agentStatus !== "declined") {
          bs.agents.set(near.listing.agentId, near.agentStatus);
        }
      }

      if (active && isEligible(near, shoot)) {
        for (const t of THRESHOLDS) if (miles <= t) stats.counts.set(t, (stats.counts.get(t) ?? 0) + 1);
      }
    }

    bookingStats.push(stats);
  }

  // (b) Distance bands -------------------------------------------------------
  console.log("Distance bands (listings within 5 mi of a shoot, own home excluded)");
  const head = [
    pad("band", 10),
    padLeft("pairs", 7),
    padLeft("active", 7),
    padLeft("agents", 7),
    padLeft("warm", 6),
    padLeft("cold", 6),
  ].join(" ");
  console.log("  " + head);
  console.log("  " + "-".repeat(head.length));
  for (let i = 0; i < BANDS.length; i++) {
    const bs = bandStats[i];
    let warm = 0;
    for (const status of bs.agents.values()) if (status != null && WARM_STATUSES.has(status)) warm++;
    const cold = bs.agents.size - warm;
    console.log(
      "  " +
        [
          pad(BANDS[i].label, 10),
          padLeft(String(bs.pairs), 7),
          padLeft(String(bs.activePairs), 7),
          padLeft(String(bs.agents.size), 7),
          padLeft(String(warm), 6),
          padLeft(String(cold), 6),
        ].join(" ")
    );
  }
  console.log(
    "  agents = distinct agents with an active, non-declined listing here that isn't the shoot's own contact;\n" +
      "  warm = warm/interested/regular/worked_once, cold = cold or no agent record\n"
  );

  // (c) Per booking ----------------------------------------------------------
  const byDate = [...bookingStats].sort(
    (a, b) => (b.shoot.jobDate?.getTime() ?? -Infinity) - (a.shoot.jobDate?.getTime() ?? -Infinity)
  );

  console.log(`Per shoot (${byDate.length} with a point; active, non-declined, other-agent listings within…)`);
  console.log(
    "  " +
      [
        pad("address", 34),
        pad("city", 16),
        pad("job date", 12),
        pad("shot", 5),
        ...THRESHOLDS.map((t) => padLeft(`${t}mi`, 6)),
      ].join(" ")
  );
  console.log("  " + "-".repeat(34 + 16 + 12 + 5 + THRESHOLDS.length * 6 + (4 + THRESHOLDS.length)));
  for (const s of byDate) {
    console.log(
      "  " +
        [
          pad(s.shoot.address || "(no address)", 34),
          pad(s.shoot.city || "—", 16),
          pad(dateLabel(s.shoot.jobDate), 12),
          pad(s.shoot.shot ? "yes" : "no", 5),
          ...THRESHOLDS.map((t) => padLeft(String(s.counts.get(t) ?? 0), 6)),
        ].join(" ")
    );
  }
  console.log("");

  // (d) Density --------------------------------------------------------------
  console.log("Density (all listings of any status within 1 mi — in-town vs rural shoots)");
  const densest = Math.max(1, ...byDate.map((s) => s.density));
  console.log(
    "  " +
      [pad("address", 34), pad("city", 16), pad("job date", 12), padLeft("within 1mi", 11), " "].join(" ")
  );
  console.log("  " + "-".repeat(34 + 16 + 12 + 12 + 30));
  for (const s of byDate) {
    console.log(
      "  " +
        [
          pad(s.shoot.address || "(no address)", 34),
          pad(s.shoot.city || "—", 16),
          pad(dateLabel(s.shoot.jobDate), 12),
          padLeft(String(s.density), 11),
          " ",
          meter(s.density, densest),
        ].join(" ")
    );
  }
  console.log("");

  // (e) CSV ------------------------------------------------------------------
  pairs.sort((a, b) => a.shoot.jobDate && b.shoot.jobDate
    ? b.shoot.jobDate.getTime() - a.shoot.jobDate.getTime() || a.miles - b.miles
    : a.miles - b.miles);

  const header = [
    "booking_id",
    "booking_address",
    "booking_city",
    "job_date",
    "shot",
    "listing_id",
    "listing_address",
    "listing_city",
    "miles",
    "still_active",
    "market_status",
    "agent_name",
    "agent_status",
    "same_agent",
  ];

  const lines = pairs.map((p) =>
    [
      p.shoot.id,
      p.shoot.address,
      p.shoot.city,
      dateLabel(p.shoot.jobDate),
      p.shoot.shot ? "yes" : "no",
      p.near.listing.id,
      p.near.listing.address ?? "",
      p.near.listing.city ?? "",
      p.miles.toFixed(2),
      p.active ? "yes" : "no",
      p.near.listing.marketStatus ?? "",
      p.near.agentName ?? "",
      p.near.agentStatus ?? "",
      p.sameAgent ? "yes" : "no",
    ]
      .map((v) => csvField(String(v)))
      .join(",")
  );

  mkdirSync(dirname(EXPORT_PATH), { recursive: true });
  writeFileSync(EXPORT_PATH, [header.map(csvField).join(","), ...lines].join("\n") + "\n");

  const shootsWithPairs = new Set(pairs.map((p) => p.shoot.id)).size;
  console.log(
    `Pairs within ${MAX_MILES} mi: ${pairs.length} across ${shootsWithPairs}/${shoots.length} shoots ` +
      `(${pairs.filter((p) => p.miles <= 0.5).length} within 0.5 mi)`
  );
  console.log(`CSV: ${EXPORT_PATH} (${pairs.length} rows)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
