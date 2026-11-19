import { estimateDriveMinutes, estimateDriveTime } from "@/lib/driveTime";
import { COAST_CITIES, PORTLAND_CITIES } from "@/lib/marketCities";

/**
 * The markets Lukas works, each its own tab on the Leads page and its own row
 * in the Home funnel (set up 2026-11-12):
 *
 * - **local**: around home (Winston / Roseburg), within LOCAL_MAX_MINUTES of
 *   Winston: Roseburg, Sutherlin, Glide, Myrtle Creek, Dillard and so on.
 * - **regional**: the trips he drives himself, Eugene to Salem, Medford and
 *   Ashland, the coast, Bend. Everything that isn't local or a shooter market
 *   lands here, including cities missing from the drive table.
 * - **shooter markets** (SHOOTER_MARKETS below): areas shot by subcontracted
 *   photographers while Lukas edits. Portland (2026-11-12) and the Coast
 *   (2026-11-16). Adding a region is one more entry in that list: its tab,
 *   funnel row, texting quota, variant "Market" option, card drive times,
 *   {{area}} wording, portfolio area and contact card all follow from it.
 *
 * A shooter job pays him less than one he shoots himself, so shooter-market
 * outreach is on top of the rest, never instead of it.
 */

/** One photographer who shoots part of a market. */
export interface MarketShooter {
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
  /** Dollars per hour of drive past freeMinutes; absent = they don't charge drive time. */
  drivePerHour?: number;
}

/** One area the photographers above cover. */
interface ShooterMarketConfig {
  key: string;
  /** Tab and quota label. */
  label: string;
  /** Who shoots it, and where from. Every drive time on a card is per shooter. */
  shooters: readonly MarketShooter[];
  /**
   * The market's anchor: area wording, the point-area radius and the portfolio
   * page read from it (not any one shooter's home).
   */
  base: { name: string; lat: number; lng: number };
  /**
   * Every town in the market (lowercase) with its centre, for listings that
   * have no usable geocode (lib/marketCities.ts).
   */
  cities: Record<string, readonly [number, number]>;
  /** Any listing in one of these states is in this market (the only WA listings are Vancouver-area ones). */
  states?: readonly string[];
  /** Phone area codes that place an agent with no listing or home city here (lib/agentMarket.ts). */
  areaCodes?: readonly string[];
  /** A listing with no city but a geocode inside this box and radius is in the market. */
  pointArea: { minLat?: number; maxLat?: number; maxLng?: number; radiusMiles: number };
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
    // County stay regional. Chris shoots from inner SE (Woodstock) and Elijah
    // from Oregon City, so each listing goes to whoever is nearer.
    key: "portland",
    label: "Portland",
    shooters: [
      // SE Woodstock & 52nd: free within an hour, no drive charge.
      { name: "Chris", label: "Chris", role: "main", at: { lat: 45.4795, lng: -122.6105 }, freeMinutes: 60 },
      // Spyglass Ln, Oregon City: free within 20 minutes, then $50/h.
      {
        name: "Elijah",
        label: "Elijah",
        role: "main",
        at: { lat: 45.3139, lng: -122.5547 },
        freeMinutes: 20,
        drivePerHour: 50,
      },
    ],
    base: { name: "Oregon City", lat: 45.3573, lng: -122.6068 },
    cities: PORTLAND_CITIES,
    states: ["WA"],
    // Portland, its 971 overlay and Vancouver WA.
    areaCodes: ["503", "971", "360"],
    // North of Woodburn and within 30 miles of Oregon City.
    pointArea: { minLat: 45.2, radiusMiles: 30 },
    // Metro roads wind about 1.3x the straight line at ~45 mph, plus a few
    // minutes getting going (Elijah's Oregon City to downtown Portland is
    // 12 mi ≈ 25 min; Chris in Woodstock is ~10 min out).
    drive: { startMinutes: 5, minutesPerMile: 1.6 },
    areaPhrase: "in the Portland area",
    portfolioArea: "the Portland area",
    pageLocation: "Portland, Oregon",
    vcard: { city: "Portland", note: "Portland area." },
    // Lukas, 2026-11-13: a couple of Portland bookings a week by the new year.
    jobsPerWeek: 2,
  },
  {
    // The Coast (2026-11-16): Tillamook County and Lincoln County, Lincoln
    // City to Yachats and inland to Siletz and Eddyville. Jenny shoots from
    // Netarts (north), Emily is the backup out of Newport (south). Clatsop
    // County (Seaside, Cannon Beach) and Florence stay regional. The key stays
    // "central_coast" — stored data and the iPhone app use it. 541 is all of
    // southern Oregon too, so no area code places an agent here; only their
    // listings or home city do.
    key: "central_coast",
    label: "Coast",
    shooters: [
      // Netarts: free within 45 minutes, no drive charge.
      { name: "Jenny Bocko", label: "Jenny", role: "main", at: { lat: 45.4318, lng: -123.9453 }, freeMinutes: 45 },
      // Newport: the backup, shown on cards but never steering the sort.
      {
        name: "Emily Castleberry",
        label: "Emily",
        role: "backup",
        at: { lat: 44.6368, lng: -124.0535 },
        freeMinutes: 30,
      },
    ],
    base: { name: "Tillamook", lat: 45.4562, lng: -123.844 },
    cities: COAST_CITIES,
    pointArea: { minLat: 44.27, maxLat: 45.76, maxLng: -123.55, radiusMiles: 85 },
    // 101 winds through Cape Meares, Hebo and every beach town at 35-55 mph
    // (Netarts to Lincoln City ≈ 1h, to Newport ≈ 1h40; Newport to Yachats
    // ≈ 35 min), so a bit slower per straight-line mile than the metro.
    drive: { startMinutes: 5, minutesPerMile: 1.7 },
    areaPhrase: "here on the coast",
    portfolioArea: "the coast",
    pageLocation: "Oregon Coast",
    vcard: { city: "Tillamook", note: "Oregon Coast." },
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

/**
 * Where a place is for drive times: the usable geocode point, else its town's
 * centre from the market's `cities`, else nowhere.
 */
function locationOf(place: MarketPlace, m: ShooterMarket): { lat: number; lng: number } | null {
  const at = point(place);
  if (at) return at;
  const town = m.cities[normalizeCity(place.city)];
  return town ? { lat: town[0], lng: town[1] } : null;
}

/** One-way minutes from `at` to a shooter's home, unrounded. */
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

/** Index in `m.shooters` of the main shooter nearest `at` (ties → first listed), or -1 if there are none. */
function ownerIndex(m: ShooterMarket, at: { lat: number; lng: number }): number {
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
  return key ? SHOOTER_MARKETS.find((m) => key in m.cities) ?? null : null;
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

/** One shooter's drive to a shooter-market listing. */
export interface ShooterDrive {
  name: string;
  label: string;
  role: "main" | "backup";
  /** One-way minutes, rounded to 5. */
  minutes: number;
  /** "~25 min" (existing durationLabel). */
  duration: string;
  /** Estimated drive charge in dollars (drivePerHour × minutes past freeMinutes / 60, rounded to $5); 0 if none. */
  driveCost: number;
}

/** Every shooter's drive to a shooter-market listing, best first; null outside shooter markets or with no location. */
export function shooterDrives(place: MarketPlace): ShooterDrive[] | null {
  const m = shooterMarket(marketFor(place));
  if (!m) return null;
  const at = locationOf(place, m);
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

  // The listing's owner leads the list; everyone else follows by minutes.
  const owner = ownerIndex(m, at);
  const rest = drives.filter((_, i) => i !== owner).sort((a, b) => a.minutes - b.minutes);
  return owner >= 0 ? [drives[owner], ...rest] : rest;
}

/**
 * Minutes from the listing's owner (its nearest main shooter); null with no
 * location.
 */
export function ownerMinutes(place: MarketPlace, market: ShooterMarketKey): number | null {
  const m = shooterMarket(market)!;
  const at = locationOf(place, m);
  if (!at) return null;
  const owner = ownerIndex(m, at);
  if (owner < 0) return null;
  return roundMinutes(driveMinutes(at, m.shooters[owner].at, m.drive));
}

/**
 * Orders a shooter-market section so every main shooter gets an even share
 * of outreach (Lukas, 2026-11-19): each item goes to its owner (nearest main
 * shooter); each owner's queue is sorted by score = owner minutes + 0.5 × the
 * average minutes of the OTHER main shooters (so a listing close to both
 * beats one close to only one); ties keep the input order. Queues are then
 * interleaved round-robin in the order the mains are listed (Chris, Elijah,
 * Chris, …); when a queue runs out the rest continue. Items with no location go
 * last in input order. With one main shooter this is just nearest first.
 */
export function balanceByShooter<T>(
  items: T[],
  placeOf: (item: T) => MarketPlace,
  market: ShooterMarketKey
): T[] {
  const m = shooterMarket(market)!;
  const mains = m.shooters.filter((s) => s.role === "main");
  if (mains.length === 0) return [...items];

  const queues: { item: T; score: number }[][] = mains.map(() => []);
  const unplaced: T[] = [];

  for (const item of items) {
    const at = locationOf(placeOf(item), m);
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
 * listings (driveTime.ts), per shooter for shooter-market ones — e.g.
 * "~20 min Chris · ~30 min Elijah", with a backup marked and any drive charge
 * added — so a Portland card doesn't read "~3h drive".
 */
export function listingDriveTime(place: MarketPlace): string | null {
  const m = shooterMarket(marketFor(place));
  if (m) {
    const drives = shooterDrives(place);
    if (!drives) return null;
    return drives
      .map(
        (d) =>
          `${d.duration} ${d.label}${d.role === "backup" ? " (backup)" : ""}${d.driveCost > 0 ? ` +$${d.driveCost}` : ""}`
      )
      .join(" · ");
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

/**
 * "in the Portland area" / "on the coast": the preposition a portfolio page
 * puts before its area (Lukas, 2026-11-19: say "the coast" like a local,
 * not "the Oregon coast").
 */
export function inArea(area: string): string {
  return /\bcoast$/i.test(area.trim()) ? `on ${area}` : `in ${area}`;
}

/** Every city name a shooter market knows (lowercase), for its portfolio template's towns and {{area}}. */
export function shooterMarketTowns(market: ShooterMarketKey): string[] {
  return Object.keys(shooterMarket(market)!.cities);
}

/**
 * The shooter market a free-text portfolio area reads as ("the Portland
 * area", "Lake Oswego", "the Oregon coast", "Newport"), or null for Lukas's
 * own Eugene & Roseburg side. Picks the page's footer line and the contact
 * card.
 */
export function shooterMarketForArea(area: string | null | undefined): ShooterMarket | null {
  const text = (area ?? "").trim().toLowerCase();
  if (!text) return null;
  return (
    SHOOTER_MARKETS.find(
      (m) =>
        text === m.portfolioArea.toLowerCase() ||
        text.includes(m.base.name.toLowerCase()) ||
        Object.keys(m.cities).some((town) => text === town || text.startsWith(`${town},`))
    ) ??
    // "the Portland area", "Portland metro", "Vancouver, WA".
    (/portland|vancouver/.test(text) ? shooterMarket("portland") : /central (oregon )?coast|oregon coast/.test(text) ? shooterMarket("central_coast") : null)
  );
}
