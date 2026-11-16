import { estimateDriveMinutes, estimateDriveTime } from "@/lib/driveTime";

/**
 * The markets Lukas works, each its own tab on the Leads page and its own row
 * in the Home funnel (set up 2026-11-12):
 *
 * - **local**: around home (Winston / Roseburg), within LOCAL_MAX_MINUTES of
 *   Winston: Roseburg, Sutherlin, Glide, Myrtle Creek, Dillard and so on.
 * - **regional**: the trips he drives himself, Eugene to Salem, Medford and
 *   Ashland, the coast, Bend. Everything that isn't local or a shooter market
 *   lands here, including cities missing from the drive table.
 * - **shooter markets** (SHOOTER_MARKETS below): areas shot by a subcontracted
 *   photographer while Lukas edits. Portland (2026-11-12) and the Central
 *   Coast (2026-11-16). Adding a region is one more entry in that list: its
 *   tab, funnel row, texting quota, variant "Market" option, card drive times,
 *   {{area}} wording, portfolio area and contact card all follow from it.
 *
 * A shooter job pays him less than one he shoots himself, so shooter-market
 * outreach is on top of the rest, never instead of it.
 */

/** One area a subcontracted photographer covers. */
interface ShooterMarketConfig {
  key: string;
  /** Tab and quota label. */
  label: string;
  /** Who shoots it (shooters.name), for reference. */
  shooters: readonly string[];
  /** Where the photographer is based: Leads cards read "~25 min from {base.name}". */
  base: { name: string; lat: number; lng: number };
  /**
   * Every city in the market (lowercase), with rough straight-line miles from
   * the base for listings that have no usable geocode. Estimates.
   */
  milesFromBase: Record<string, number>;
  /** Any listing in one of these states is in this market (the only WA listings are Vancouver-area ones). */
  states?: readonly string[];
  /** Phone area codes that place an agent with no listing or home city here (lib/agentMarket.ts). */
  areaCodes?: readonly string[];
  /** A listing with no city but a geocode inside this box and radius is in the market. */
  pointArea: { minLat?: number; maxLat?: number; maxLng?: number; radiusMiles: number };
  /** Upper miles of the nearness bands 0, 1, 2 on the tab (3 = the edges, 4 = unknown). */
  bands: readonly [number, number, number];
  /** Drive minutes ≈ startMinutes + miles × minutesPerMile (roads wind more than the straight line). */
  drive: { startMinutes: number; minutesPerMile: number };
  /** {{area}} for its cities: "in the Portland area". */
  areaPhrase: string;
  /** A market agent's portfolio area ("Real estate photo & video in the Portland area"), instead of their own town. */
  portfolioArea: string;
  /** The portfolio page's footer place line. */
  pageLocation: string;
  /** The contact card's city and note. */
  vcard: { city: string; note: string };
  /** Bookings a week Lukas wants here, on top of home: the quota is worked back from it (lib/goal.ts). */
  jobsPerWeek: number;
}

const SHOOTER_MARKETS_CONFIG = [
  {
    // The Portland metro: Multnomah, Washington, Clackamas, Yamhill and
    // Columbia counties plus Clark County, WA. Salem and the rest of Marion
    // County stay regional.
    key: "portland",
    label: "Portland",
    shooters: ["Elijah", "Chris"],
    base: { name: "Oregon City", lat: 45.3573, lng: -122.6068 },
    milesFromBase: {
      // Clackamas
      "oregon city": 0,
      gladstone: 2,
      "west linn": 2,
      beavercreek: 5,
      redland: 5,
      "lake oswego": 6,
      milwaukie: 6,
      clackamas: 6,
      "oak grove": 5,
      "jennings lodge": 3,
      "happy valley": 7,
      mulino: 7,
      damascus: 8,
      canby: 8,
      rivergrove: 7,
      barlow: 9,
      wilsonville: 10,
      boring: 12,
      molalla: 13,
      colton: 14,
      "eagle creek": 15,
      estacada: 16,
      sandy: 18,
      welches: 30,
      rhododendron: 33,
      "government camp": 40,
      // Multnomah
      portland: 12,
      gresham: 13,
      fairview: 16,
      "wood village": 17,
      troutdale: 18,
      "maywood park": 13,
      corbett: 25,
      // Washington
      tualatin: 9,
      tigard: 12,
      "king city": 12,
      durham: 10,
      sherwood: 13,
      beaverton: 15,
      "garden home": 12,
      "cedar mill": 17,
      aloha: 18,
      bethany: 19,
      hillsboro: 21,
      cornelius: 24,
      "north plains": 25,
      "forest grove": 26,
      gaston: 28,
      banks: 30,
      timber: 38,
      // Yamhill
      newberg: 18,
      dundee: 20,
      dayton: 25,
      lafayette: 25,
      yamhill: 30,
      carlton: 30,
      mcminnville: 30,
      amity: 33,
      sheridan: 40,
      willamina: 42,
      // Columbia
      scappoose: 28,
      "saint helens": 35,
      "st. helens": 35,
      "st helens": 35,
      "columbia city": 37,
      vernonia: 40,
      rainier: 50,
      clatskanie: 58,
    },
    states: ["WA"],
    // Portland, its 971 overlay and Vancouver WA.
    areaCodes: ["503", "971", "360"],
    // North of Woodburn and within 30 miles of Oregon City.
    pointArea: { minLat: 45.2, radiusMiles: 30 },
    // Oregon City and its neighbours (West Linn, Lake Oswego, Milwaukie), then
    // inner Portland / Tigard / Gresham, then Beaverton to Hillsboro and
    // Newberg, then the edges.
    bands: [10, 18, 28],
    // Metro roads wind about 1.3x the straight line at ~45 mph, plus a few
    // minutes getting going (12 mi to downtown Portland ≈ 25 min, 21 mi to
    // Hillsboro ≈ 40).
    drive: { startMinutes: 5, minutesPerMile: 1.6 },
    areaPhrase: "in the Portland area",
    portfolioArea: "the Portland area",
    pageLocation: "Portland, Oregon",
    vcard: { city: "Portland", note: "Portland area." },
    // Lukas, 2026-11-13: a couple of Portland bookings a week by the new year.
    jobsPerWeek: 2,
  },
  {
    // Lincoln County, Lincoln City to Yachats and inland to Siletz and
    // Eddyville (2026-11-16), shot by Christian from the Yachats / Newport
    // area. Florence (Lane County) and the coast north of Cascade Head stay
    // regional. 541 is all of southern Oregon too, so no area code places an
    // agent here; only their listings or home city do.
    key: "central_coast",
    label: "Central Coast",
    shooters: ["Christian"],
    base: { name: "Newport", lat: 44.6368, lng: -124.0535 },
    milesFromBase: {
      newport: 0,
      "south beach": 2,
      "agate beach": 3,
      toledo: 7,
      "otter rock": 8,
      "seal rock": 10,
      "depoe bay": 12,
      "lincoln beach": 13,
      waldport: 15,
      siletz: 15,
      "gleneden beach": 16,
      eddyville: 18,
      kernville: 20,
      logsden: 22,
      yachats: 23,
      tidewater: 24,
      "lincoln city": 24,
      neotsu: 27,
      otis: 28,
      "rose lodge": 31,
    },
    pointArea: { minLat: 44.27, maxLat: 45.05, maxLng: -123.6, radiusMiles: 32 },
    // Newport, Toledo and Otter Rock, then Waldport to Depoe Bay and Siletz,
    // then Yachats and Lincoln City, then the edges.
    bands: [8, 16, 24],
    // Mostly 101 at 45-55 mph with towns to slow through (23 mi to Yachats ≈ 35 min).
    drive: { startMinutes: 5, minutesPerMile: 1.3 },
    areaPhrase: "on the central Oregon coast",
    portfolioArea: "the central Oregon coast",
    pageLocation: "Central Oregon Coast",
    vcard: { city: "Newport", note: "Central Oregon Coast." },
    // A guess to start from (2026-11-16): one a week. Change it here.
    jobsPerWeek: 1,
  },
] as const satisfies readonly ShooterMarketConfig[];

export type ShooterMarket = ShooterMarketConfig & { key: ShooterMarketKey };
export type ShooterMarketKey = (typeof SHOOTER_MARKETS_CONFIG)[number]["key"];
export type Market = "local" | "regional" | ShooterMarketKey;

export const SHOOTER_MARKETS: readonly ShooterMarket[] = SHOOTER_MARKETS_CONFIG;

export const MARKET_ORDER: Market[] = ["local", "regional", ...SHOOTER_MARKETS.map((m) => m.key)];

export const MARKET_LABELS = Object.fromEntries([
  ["local", "Local"],
  ["regional", "Regional"],
  ...SHOOTER_MARKETS.map((m) => [m.key, m.label]),
]) as Record<Market, string>;

/** A zero for every market, for tallies. */
export function emptyMarketRecord<T>(make: () => T): Record<Market, T> {
  return Object.fromEntries(MARKET_ORDER.map((m) => [m, make()])) as Record<Market, T>;
}

/** The shooter market's config, or null for local / regional / null. */
export function shooterMarket(market: Market | string | null | undefined): ShooterMarket | null {
  return SHOOTER_MARKETS.find((m) => m.key === market) ?? null;
}

export function isShooterMarket(market: Market | string | null | undefined): market is ShooterMarketKey {
  return shooterMarket(market) != null;
}

/** Within this many minutes of Winston is local (the same ring as the Leads page's nearest drive band). */
const LOCAL_MAX_MINUTES = 45;

/** Straight-line miles (same formula as nearShoots.ts, copied so this file stays free of the database). */
function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

function normalizeCity(city: string | null | undefined): string {
  return (city ?? "").trim().toLowerCase();
}

/** The fields a listing (or booking) needs to be placed in a market. */
export interface MarketPlace {
  city: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
  geocodeSource?: string | null;
}

/** A usable point: geocoded to the house, not just the street (as nearShoots.ts). */
function point(p: MarketPlace): { lat: number; lng: number } | null {
  if (p.lat == null || p.lng == null || p.geocodeSource === "osm_street") return null;
  return { lat: p.lat, lng: p.lng };
}

function inPointArea(m: ShooterMarket, at: { lat: number; lng: number }): boolean {
  const a = m.pointArea;
  if (a.minLat != null && at.lat < a.minLat) return false;
  if (a.maxLat != null && at.lat > a.maxLat) return false;
  if (a.maxLng != null && at.lng > a.maxLng) return false;
  return milesBetween(at, m.base) <= a.radiusMiles;
}

/** The shooter market a city name belongs to (lowercase match), or null. */
export function shooterMarketForCity(city: string | null | undefined): ShooterMarket | null {
  const key = normalizeCity(city);
  return key ? SHOOTER_MARKETS.find((m) => key in m.milesFromBase) ?? null : null;
}

export function marketFor(place: MarketPlace): Market {
  const city = normalizeCity(place.city);
  const state = (place.state ?? "").trim().toUpperCase();
  const byState = state ? SHOOTER_MARKETS.find((m) => m.states?.includes(state)) : undefined;
  if (byState) return byState.key;
  const byCity = shooterMarketForCity(city);
  if (byCity) return byCity.key;
  if (!city) {
    // No city: fall back on the point.
    const at = point(place);
    const byPoint = at ? SHOOTER_MARKETS.find((m) => inPointArea(m, at)) : undefined;
    if (byPoint) return byPoint.key;
  }
  const minutes = city ? estimateDriveMinutes(city) : null;
  if (minutes != null && minutes <= LOCAL_MAX_MINUTES) return "local";
  return "regional";
}

/** Miles from the market's photographer, from the geocode when there is one, else the city table; null if neither. */
export function milesFromBase(place: MarketPlace, market: ShooterMarketKey): number | null {
  const m = shooterMarket(market)!;
  const at = point(place);
  if (at) return milesBetween(at, m.base);
  return m.milesFromBase[normalizeCity(place.city)] ?? null;
}

/**
 * A shooter-market tab's nearness bands, the counterpart of the Leads page's
 * drive bands from Winston: 0–2 by the market's `bands`, 3 the edges, 4
 * unknown (sorts last).
 */
export function shooterBand(place: MarketPlace, market: ShooterMarketKey): number {
  const miles = milesFromBase(place, market);
  if (miles == null) return 4;
  const [a, b, c] = shooterMarket(market)!.bands;
  return miles <= a ? 0 : miles <= b ? 1 : miles <= c ? 2 : 3;
}

/** Parses a `?market=` value; anything else is null. */
export function parseMarket(value: string | string[] | null | undefined): Market | null {
  const v = Array.isArray(value) ? value[0] : value;
  return (MARKET_ORDER as string[]).includes(v ?? "") ? (v as Market) : null;
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `~${Math.max(5, minutes)} min`;
  const m = minutes % 60;
  return `~${Math.floor(minutes / 60)}h${m ? ` ${m}m` : ""}`;
}

/**
 * The drive time a listing's card shows: from Winston for local and regional
 * listings (driveTime.ts), from the market's photographer for shooter-market
 * ones, so a Portland card doesn't read "~3h drive".
 */
export function listingDriveTime(place: MarketPlace): string | null {
  const m = shooterMarket(marketFor(place));
  if (m) {
    const miles = milesFromBase(place, m.key);
    if (miles == null) return null;
    const minutes = Math.round((m.drive.startMinutes + miles * m.drive.minutesPerMile) / 5) * 5;
    return `${durationLabel(minutes)} from ${m.base.name}`;
  }
  return place.city ? estimateDriveTime(place.city) : null;
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

/** Every city name a shooter market knows (lowercase), for its portfolio template's towns and {{area}}. */
export function shooterMarketTowns(market: ShooterMarketKey): string[] {
  return Object.keys(shooterMarket(market)!.milesFromBase);
}

/**
 * The shooter market a free-text portfolio area reads as ("the Portland
 * area", "Lake Oswego", "the central Oregon coast", "Newport"), or null for
 * Lukas's own Eugene & Roseburg side. Picks the page's footer line and the
 * contact card.
 */
export function shooterMarketForArea(area: string | null | undefined): ShooterMarket | null {
  const text = (area ?? "").trim().toLowerCase();
  if (!text) return null;
  return (
    SHOOTER_MARKETS.find(
      (m) =>
        text === m.portfolioArea.toLowerCase() ||
        text.includes(m.base.name.toLowerCase()) ||
        Object.keys(m.milesFromBase).some((town) => text === town || text.startsWith(`${town},`)),
    ) ??
    // "the Portland area", "Portland metro", "Vancouver, WA".
    (/portland|vancouver/.test(text) ? shooterMarket("portland") : /central (oregon )?coast/.test(text) ? shooterMarket("central_coast") : null)
  );
}
