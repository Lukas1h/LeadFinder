import { estimateDriveMinutes, estimateDriveTime } from "@/lib/driveTime";
import { DEFAULT_PORTFOLIO_PRICES, resolvePortfolioPrices, type PortfolioPrices } from "@/lib/portfolioPrices";
import type { ShooterRates } from "@/db/schema";

/**
 * The markets Lukas works. Since 2026-11-25 they live in the `markets` table
 * (one row each; shooters on `shooters.market_key`) and are edited on the
 * Markets page, so a new area needs no code change or app update. This file
 * is the pure logic over them, with no database: `MarketIndex` is built
 * from the rows once per request (lib/marketsData.ts: `getMarkets()`) and
 * answers every "which market / how far / what wording / what price"
 * question. Client components never build one; the server hands them the
 * computed strings.
 *
 * - **local** (kind local): around home (Winston / Roseburg), within
 *   LOCAL_MAX_MINUTES of Winston by the drive table.
 * - **regional** (kind regional): the rest of Oregon he drives to himself.
 *   Any Oregon listing that isn't local or in a shooter market lands here.
 * - **shooter markets** (kind shooter): shot by subcontracted
 *   photographers while Lukas edits. A listing is in one by its town
 *   (`cities`) or its geocode inside `pointArea` around `base`.
 * - **unassigned** (virtual, no row): out of state and in no market, so an
 *   out-of-state lead never pollutes the home funnel. Shown as "Other".
 *
 * status testing / active = a tab, a quota and a funnel row; paused /
 * killed = no tab or quota, but listings still land there (so they don't
 * fall into regional) and their history stays on the Markets page.
 *
 * A shooter job pays him less than one he shoots himself, so shooter-market
 * outreach is on top of the rest, never instead of it.
 */

/** A market key: "local", "regional", a shooter market's key, or "unassigned". */
export type Market = string;
export type MarketKind = "local" | "regional" | "shooter";
export type MarketStatus = "testing" | "active" | "paused" | "killed";

export const UNASSIGNED = "unassigned";
export const MARKET_STATUSES: MarketStatus[] = ["testing", "active", "paused", "killed"];

/** One photographer who shoots part of a market. */
export interface MarketShooter {
  id: string;
  /** shooters.name in the database. */
  name: string;
  /** Short name on cards ("Chris"). */
  label: string;
  /** "main": outreach is centred on them. "backup": shown on cards, never steers sorting. */
  role: "main" | "backup";
  /** Where they're based. */
  at: { lat: number; lng: number };
  /** Drive minutes (one way) with no drive charge. */
  freeMinutes: number;
  /** Dollars per hour of drive past freeMinutes; null = they don't charge drive time. */
  drivePerHour: number | null;
  /** What Lukas pays them per job. */
  rates: ShooterRates;
  portfolioPhotos: { src: string; alt: string }[];
}

/** One market, as stored (plain data: safe to pass to a client component). */
export interface MarketDef {
  key: string;
  label: string;
  kind: MarketKind;
  status: MarketStatus;
  sortOrder: number;
  /** Two-letter state, and other states its towns may be in. */
  state: string;
  states: string[];
  timeZone: string;
  /** The anchor: area wording, the point-area radius and the portfolio page read from it. Required for shooter markets. */
  base: { name: string; lat: number; lng: number } | null;
  /** Every listed town (lowercase) with its centre. */
  cities: Record<string, readonly [number, number]>;
  /** A geocoded listing inside this box and radius of `base` is in the market. */
  pointArea: { minLat?: number; maxLat?: number; minLng?: number; maxLng?: number; radiusMiles: number } | null;
  /** Phone area codes that place an agent with no listing or home city here (lib/agentMarket.ts). */
  areaCodes: string[];
  /** Drive minutes ≈ startMinutes + miles × minutesPerMile. */
  drive: { startMinutes: number; minutesPerMile: number };
  /** {{area}} for its towns: "in the Portland area". */
  areaPhrase: string | null;
  /** A market agent's portfolio area ("the Portland area"), instead of their own town. */
  portfolioArea: string | null;
  /** The portfolio page's footer place line. */
  pageLocation: string | null;
  /** The contact card's city and note. */
  vcard: { city: string; note: string } | null;
  /** Bookings a week Lukas wants here, on top of home: the quota is worked back from it (lib/goal.ts). */
  jobsPerWeek: number;
  /** Price overrides (a missing key = DEFAULT_PORTFOLIO_PRICES). */
  prices: Partial<PortfolioPrices>;
  launchedAt: string | null;
  killedAt: string | null;
  notes: string | null;
  /** Active shooters placed in this market. */
  shooters: MarketShooter[];
}

/** A shooter market: always has a base. */
export type ShooterMarket = MarketDef & { kind: "shooter"; base: { name: string; lat: number; lng: number } };

/** The fields a listing (or booking) needs to be placed in a market. */
export interface MarketPlace {
  city: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
  geocodeSource?: string | null;
}

/** One shooter's drive to a shooter-market listing. */
export interface ShooterDrive {
  name: string;
  label: string;
  role: "main" | "backup";
  /** One-way minutes, rounded to 5. */
  minutes: number;
  /** "~25 min". */
  duration: string;
  /** Estimated drive charge in dollars (drivePerHour × minutes past freeMinutes / 60, rounded to $5); 0 if none. */
  driveCost: number;
}

/** What a message needs to know about the market it's sent into (lib/messageTemplate.ts). */
export interface MarketMessageContext {
  /** {{area}}; null = no city. */
  areaPhrase: string | null;
  prices: PortfolioPrices;
  /** "Oregon": the state named in the no-city fallback. */
  stateName: string;
  /** False out of state: "{{area}} as well as most of the state" drops the claim. */
  coversState: boolean;
}

export const DEFAULT_DRIVE = { startMinutes: 5, minutesPerMile: 1.6 };

/** Within this many minutes of Winston is local (the same ring as the Leads page's nearest drive band). */
const LOCAL_MAX_MINUTES = 45;

const STATE_NAMES: Record<string, string> = {
  OR: "Oregon", WA: "Washington", ID: "Idaho", CA: "California", NV: "Nevada", AZ: "Arizona",
  UT: "Utah", MT: "Montana", CO: "Colorado", TX: "Texas", NM: "New Mexico", WY: "Wyoming",
};

export function stateName(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  return STATE_NAMES[c] ?? (c || "Oregon");
}

/** Straight-line miles. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

function normalizeCity(city: string | null | undefined): string {
  return (city ?? "").trim().toLowerCase();
}

/** A usable point: geocoded to the house, not just the street (as nearShoots.ts). */
function point(p: MarketPlace): { lat: number; lng: number } | null {
  if (p.lat == null || p.lng == null || p.geocodeSource === "osm_street") return null;
  return { lat: p.lat, lng: p.lng };
}

function driveMinutes(
  at: { lat: number; lng: number },
  shooterAt: { lat: number; lng: number },
  drive: { startMinutes: number; minutesPerMile: number }
): number {
  return drive.startMinutes + milesBetween(at, shooterAt) * drive.minutesPerMile;
}

function roundMinutes(minutes: number): number {
  return Math.round(minutes / 5) * 5;
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `~${Math.max(5, minutes)} min`;
  const m = minutes % 60;
  return `~${Math.floor(minutes / 60)}h${m ? ` ${m}m` : ""}`;
}

function isShooterDef(m: MarketDef | null | undefined): m is ShooterMarket {
  return m != null && m.kind === "shooter" && m.base != null;
}

/** Shown as a tab, a quota and a funnel row. */
export function isLive(m: Pick<MarketDef, "status">): boolean {
  return m.status === "testing" || m.status === "active";
}

/**
 * A template's variants for a listing in `market`: its own enabled variants
 * for that market when it has any, else the regular ones (market null).
 * Market-specific wording never reaches another market's agents.
 */
export function variantsForMarket<T extends { market: string | null }>(variants: T[], market: Market | null): T[] {
  const own = market ? variants.filter((v) => v.market === market) : [];
  return own.length > 0 ? own : variants.filter((v) => v.market == null);
}

/**
 * "in the Portland area" / "on the coast": the preposition a portfolio page
 * puts before its area (Lukas, 2026-11-19: say "the coast" like a local).
 */
export function inArea(area: string): string {
  return /\bcoast$/i.test(area.trim()) ? `on ${area}` : `in ${area}`;
}

/**
 * Every market, built once per request from the database (lib/marketsData.ts
 * getMarkets()) or from plain defs anywhere else.
 */
export class MarketIndex {
  /** Every row, any status, in sort order. */
  readonly all: readonly MarketDef[];
  /** The shooter markets (any status), in sort order. */
  readonly shooterMarkets: readonly ShooterMarket[];

  constructor(defs: readonly MarketDef[]) {
    this.all = [...defs].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    this.shooterMarkets = this.all.filter(isShooterDef);
  }

  /** The tabs, in order: live markets (local and regional always). Unassigned is added by callers that have any. */
  get order(): Market[] {
    return this.all.filter((m) => m.kind !== "shooter" || isLive(m)).map((m) => m.key);
  }

  /** Every key marketFor can return, for tallies. */
  get keys(): Market[] {
    return [...this.all.map((m) => m.key), UNASSIGNED];
  }

  /** The live shooter markets: quotas, funnel rows. */
  get liveShooterMarkets(): ShooterMarket[] {
    return this.shooterMarkets.filter(isLive);
  }

  get labels(): Record<Market, string> {
    return Object.fromEntries([...this.all.map((m) => [m.key, m.label]), [UNASSIGNED, "Other"]]);
  }

  label(key: Market | null | undefined): string {
    if (!key) return "";
    return this.labels[key] ?? key;
  }

  /** A zero for every market key (any status, plus unassigned), for tallies. */
  emptyRecord<T>(make: () => T): Record<Market, T> {
    return Object.fromEntries(this.keys.map((k) => [k, make()]));
  }

  get(key: Market | null | undefined): MarketDef | null {
    return this.all.find((m) => m.key === key) ?? null;
  }

  /** The shooter market's config, or null for local / regional / unassigned / unknown. */
  shooterMarket(key: Market | null | undefined): ShooterMarket | null {
    return this.shooterMarkets.find((m) => m.key === key) ?? null;
  }

  isShooterMarket(key: Market | null | undefined): boolean {
    return this.shooterMarket(key) != null;
  }

  /** Parses a `?market=` value (any known key, or "unassigned"); anything else is null. */
  parse(value: string | string[] | null | undefined): Market | null {
    const v = Array.isArray(value) ? value[0] : value;
    return v && this.keys.includes(v) ? v : null;
  }

  /** The states a market's towns may be in. */
  private statesOf(m: MarketDef): string[] {
    return [m.state, ...m.states].map((s) => s.toUpperCase());
  }

  /** The shooter market a town name belongs to (lowercase match, state-checked when given), or null. */
  shooterMarketForCity(city: string | null | undefined, state?: string | null): ShooterMarket | null {
    const key = normalizeCity(city);
    if (!key) return null;
    const st = (state ?? "").trim().toUpperCase();
    return this.shooterMarkets.find((m) => key in m.cities && (!st || this.statesOf(m).includes(st))) ?? null;
  }

  private inPointArea(m: ShooterMarket, at: { lat: number; lng: number }): boolean {
    const a = m.pointArea;
    if (!a) return false;
    if (a.minLat != null && at.lat < a.minLat) return false;
    if (a.maxLat != null && at.lat > a.maxLat) return false;
    if (a.minLng != null && at.lng < a.minLng) return false;
    if (a.maxLng != null && at.lng > a.maxLng) return false;
    return milesBetween(at, m.base) <= a.radiusMiles;
  }

  /**
   * The market a listing (or booking, or town) is in: a shooter market by
   * its town, then local by the Winston drive table, then a shooter market
   * whose point area holds its geocode, then regional for Oregon (or no
   * state), else unassigned.
   */
  marketFor(place: MarketPlace): Market {
    const city = normalizeCity(place.city);
    const state = (place.state ?? "").trim().toUpperCase();
    const byCity = this.shooterMarketForCity(city, state);
    if (byCity) return byCity.key;
    const minutes = city && (!state || state === "OR") ? estimateDriveMinutes(city) : null;
    if (minutes != null && minutes <= LOCAL_MAX_MINUTES) return "local";
    // A town in the Winston drive table is one he drives to himself, so a
    // shooter market's radius never pulls it in (Aurora, Alsea).
    const at = minutes == null ? point(place) : null;
    if (at) {
      const byPoint = this.shooterMarkets.find(
        (m) => (!state || this.statesOf(m).includes(state)) && this.inPointArea(m, at)
      );
      if (byPoint) return byPoint.key;
    }
    if (!state || state === "OR") return "regional";
    return UNASSIGNED;
  }

  /** Where a place is for drive times: its usable geocode, else its town's centre in the market, else nowhere. */
  private locationOf(place: MarketPlace, m: ShooterMarket): { lat: number; lng: number } | null {
    const at = point(place);
    if (at) return at;
    const town = m.cities[normalizeCity(place.city)];
    return town ? { lat: town[0], lng: town[1] } : null;
  }

  /** Index in `m.shooters` of the main shooter nearest `at` (ties → first listed), or -1. */
  private ownerIndex(m: ShooterMarket, at: { lat: number; lng: number }): number {
    let owner = -1;
    let best = Infinity;
    m.shooters.forEach((s, i) => {
      if (s.role !== "main") return;
      const minutes = driveMinutes(at, s.at, m.drive);
      if (minutes < best) {
        best = minutes;
        owner = i;
      }
    });
    return owner;
  }

  /** Every shooter's drive to a shooter-market listing, owner first; null outside shooter markets or with no location. */
  shooterDrives(place: MarketPlace): ShooterDrive[] | null {
    const m = this.shooterMarket(this.marketFor(place));
    if (!m || m.shooters.length === 0) return null;
    const at = this.locationOf(place, m);
    if (!at) return null;

    const drives: ShooterDrive[] = m.shooters.map((s) => {
      const minutes = roundMinutes(driveMinutes(at, s.at, m.drive));
      const chargeable = Math.max(0, minutes - s.freeMinutes);
      return {
        name: s.name,
        label: s.label,
        role: s.role,
        minutes,
        duration: durationLabel(minutes),
        driveCost: s.drivePerHour ? Math.round((s.drivePerHour * chargeable) / 60 / 5) * 5 : 0,
      };
    });

    const owner = this.ownerIndex(m, at);
    const rest = drives.filter((_, i) => i !== owner).sort((a, b) => a.minutes - b.minutes);
    return owner >= 0 ? [drives[owner], ...rest] : rest;
  }

  /** Minutes from the listing's owner (its nearest main shooter); null with no location or no shooter. */
  ownerMinutes(place: MarketPlace, market: Market): number | null {
    const m = this.shooterMarket(market);
    if (!m) return null;
    const at = this.locationOf(place, m);
    if (!at) return null;
    const owner = this.ownerIndex(m, at);
    if (owner < 0) return null;
    return roundMinutes(driveMinutes(at, m.shooters[owner].at, m.drive));
  }

  /**
   * Orders a shooter-market section so every main shooter gets an even share
   * of outreach (Lukas, 2026-11-19): each item goes to its owner (nearest main
   * shooter); each owner's queue is sorted by owner minutes + 0.5 × the
   * average minutes of the OTHER main shooters; queues are interleaved
   * round-robin in the order the mains are listed. Items with no location go
   * last in input order. With one main shooter this is just nearest first;
   * with none, the input order.
   */
  balanceByShooter<T>(items: T[], placeOf: (item: T) => MarketPlace, market: Market): T[] {
    const m = this.shooterMarket(market);
    const mains = m ? m.shooters.filter((s) => s.role === "main") : [];
    if (!m || mains.length === 0) return [...items];

    const queues: { item: T; score: number }[][] = mains.map(() => []);
    const unplaced: T[] = [];

    for (const item of items) {
      const at = this.locationOf(placeOf(item), m);
      if (!at) {
        unplaced.push(item);
        continue;
      }
      const minutes = mains.map((s) => driveMinutes(at, s.at, m.drive));
      let owner = 0;
      for (let i = 1; i < minutes.length; i++) if (minutes[i] < minutes[owner]) owner = i;
      const others = minutes.filter((_, i) => i !== owner);
      const otherAverage = others.length > 0 ? others.reduce((a, b) => a + b, 0) / others.length : 0;
      queues[owner].push({ item, score: minutes[owner] + 0.5 * otherAverage });
    }

    const sorted = queues.map((q) =>
      q
        .slice()
        .sort((a, b) => a.score - b.score)
        .map((e) => e.item)
    );

    const out: T[] = [];
    const longest = Math.max(0, ...sorted.map((q) => q.length));
    for (let round = 0; round < longest; round++) {
      for (const q of sorted) if (round < q.length) out.push(q[round]);
    }
    return [...out, ...unplaced];
  }

  /**
   * The drive time a listing's card shows: from Winston for local and
   * regional listings (driveTime.ts), per shooter for shooter-market ones —
   * e.g. "~20 min Chris · ~30 min Elijah", with a backup marked and any
   * drive charge added. Null for unassigned or unknown.
   */
  listingDriveTime(place: MarketPlace): string | null {
    const key = this.marketFor(place);
    if (this.shooterMarket(key)) {
      const drives = this.shooterDrives(place);
      if (!drives) return null;
      return drives
        .map(
          (d) =>
            `${d.duration} ${d.label}${d.role === "backup" ? " (backup)" : ""}${d.driveCost > 0 ? ` +$${d.driveCost}` : ""}`
        )
        .join(" · ");
    }
    if (key === UNASSIGNED) return null;
    return place.city ? estimateDriveTime(place.city) : null;
  }

  /** Every town a shooter market knows (lowercase). */
  shooterMarketTowns(market: Market): string[] {
    return Object.keys(this.shooterMarket(market)?.cities ?? {});
  }

  /**
   * The shooter market a free-text portfolio area reads as ("the Portland
   * area", "Lake Oswego", "the coast", "Newport"), or null for Lukas's own
   * side. Picks the page's footer line, contact card and prices.
   */
  shooterMarketForArea(area: string | null | undefined): ShooterMarket | null {
    const text = (area ?? "").trim().toLowerCase();
    if (!text) return null;
    return (
      this.shooterMarkets.find(
        (m) =>
          (m.portfolioArea != null && text === m.portfolioArea.toLowerCase()) ||
          text.includes(m.base.name.toLowerCase()) ||
          text.includes(m.label.toLowerCase()) ||
          Object.keys(m.cities).some((town) => text === town || text.startsWith(`${town},`))
      ) ?? null
    );
  }

  /** The prices agents in a market pay: the market's overrides on top of the defaults. */
  prices(market: Market | null | undefined): PortfolioPrices {
    const m = this.get(market);
    return m ? resolvePortfolioPrices(m.prices) : { ...DEFAULT_PORTFOLIO_PRICES };
  }

  /** The {{area}} wording of a shooter market's town, or null (lib/areaPhrase.ts falls back to the home wording). */
  shooterAreaPhrase(city: string | null | undefined, state?: string | null): string | null {
    const m = this.shooterMarketForCity(city, state);
    return m?.areaPhrase ?? null;
  }

  /** Every town grouped with this one by a shooter market, or null (lib/areaPhrase.ts citiesNear). */
  shooterCitiesNear(city: string | null | undefined): string[] | null {
    const m = this.shooterMarketForCity(city);
    return m ? Object.keys(m.cities) : null;
  }
}

/** A market's place in its lifecycle, as words for a badge. */
export const MARKET_STATUS_LABELS: Record<MarketStatus, string> = {
  testing: "Testing",
  active: "Active",
  paused: "Paused",
  killed: "Killed",
};
