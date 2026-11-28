import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { markets, shooters, type MarketRow } from "@/db/schema";
import {
  DEFAULT_DRIVE,
  MarketIndex,
  type MarketDef,
  type MarketKind,
  type MarketShooter,
  type MarketStatus,
} from "@/lib/markets";

/**
 * Reads the `markets` table and each market's active shooters into plain
 * defs (lib/markets.ts). Server-only; scripts call this directly.
 */
export async function loadMarketDefs(): Promise<MarketDef[]> {
  const [rows, people] = await Promise.all([
    db.select().from(markets).orderBy(asc(markets.sortOrder)),
    db.select().from(shooters).where(eq(shooters.active, true)).orderBy(asc(shooters.createdAt)),
  ]);
  return rows.map((row) => toDef(row, people));
}

function toDef(row: MarketRow, people: (typeof shooters.$inferSelect)[]): MarketDef {
  const own: MarketShooter[] = people
    .filter((s) => s.marketKey === row.key && s.lat != null && s.lng != null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      label: s.label?.trim() || s.name.split(" ")[0],
      role: (s.role === "backup" ? "backup" : "main") as MarketShooter["role"],
      at: { lat: s.lat!, lng: s.lng! },
      freeMinutes: s.freeMinutes,
      drivePerHour: s.drivePerHour,
      travelFees: s.travelFees ?? {},
      maxMinutes: s.maxMinutes,
      style: (s.style === "flambient" ? "flambient" : "hdr") as MarketShooter["style"],
      rates: s.rates ?? {},
      portfolioPhotos: s.portfolioPhotos ?? [],
    }))
    // Mains first (stable, so the round-robin keeps their added order).
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "main" ? -1 : 1));
  return {
    key: row.key,
    label: row.label,
    kind: (["local", "regional", "shooter"].includes(row.kind) ? row.kind : "shooter") as MarketKind,
    status: (["testing", "active", "paused", "killed"].includes(row.status) ? row.status : "testing") as MarketStatus,
    sortOrder: row.sortOrder,
    state: row.state,
    states: row.states ?? [],
    timeZone: row.timeZone,
    base: row.base ?? null,
    cities: row.cities ?? {},
    pointArea: row.pointArea ?? null,
    areaCodes: row.areaCodes ?? [],
    drive: row.drive ?? DEFAULT_DRIVE,
    areaPhrase: row.areaPhrase,
    portfolioArea: row.portfolioArea,
    pageLocation: row.pageLocation,
    vcard: row.vcardCity ? { city: row.vcardCity, note: row.vcardNote ?? "" } : null,
    jobsPerWeek: row.jobsPerWeek,
    prices: row.prices ?? {},
    listingsStreetOnly: row.listingsStreetOnly ?? false,
    testimonialNameOnly: row.testimonialNameOnly ?? false,
    launchedAt: row.launchedAt?.toISOString() ?? null,
    killedAt: row.killedAt?.toISOString() ?? null,
    notes: row.notes,
    shooters: own,
  };
}

/** Every market, read once per request (React cache). */
export const getMarkets = cache(async (): Promise<MarketIndex> => new MarketIndex(await loadMarketDefs()));
