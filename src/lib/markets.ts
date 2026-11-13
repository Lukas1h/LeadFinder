import { estimateDriveMinutes, estimateDriveTime } from "@/lib/driveTime";

/**
 * The three markets Lukas works, each its own tab on the Leads page and its
 * own row in the Home funnel (set up 2026-11-12):
 *
 * - **local**: around home (Winston / Roseburg), within LOCAL_MAX_MINUTES of
 *   Winston: Roseburg, Sutherlin, Glide, Myrtle Creek, Dillard and so on.
 * - **regional**: the trips he drives himself, Eugene to Salem, Medford and
 *   Ashland, the coast, Bend. Everything that isn't local or Portland lands
 *   here, including cities missing from the drive table.
 * - **portland**: the Portland metro, shot by his subcontracted photographer
 *   from Oregon City (Lukas edits). Multnomah, Washington, Clackamas, Yamhill
 *   and Columbia counties plus Clark County, WA. Salem and the rest of Marion
 *   County stay regional.
 *
 * A Portland job pays him less than a local one, so Portland outreach is on
 * top of the rest, never instead of it.
 */
export type Market = "local" | "regional" | "portland";

export const MARKET_ORDER: Market[] = ["local", "regional", "portland"];

export const MARKET_LABELS: Record<Market, string> = {
  local: "Local",
  regional: "Regional",
  portland: "Portland",
};

/** Within this many minutes of Winston is local (the same ring as the Leads page's nearest drive band). */
const LOCAL_MAX_MINUTES = 45;

/** Where the Portland photographer is based. */
export const OREGON_CITY = { lat: 45.3573, lng: -122.6068 };

/**
 * Portland-market cities, with rough straight-line miles from Oregon City for
 * listings that have no usable geocode (about a third of them). Estimates.
 */
const PORTLAND_MILES_FROM_OREGON_CITY: Record<string, number> = {
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
};

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

export function marketFor(place: MarketPlace): Market {
  const city = normalizeCity(place.city);
  // The only Washington listings are Vancouver-area ones.
  if ((place.state ?? "").trim().toUpperCase() === "WA") return "portland";
  if (city in PORTLAND_MILES_FROM_OREGON_CITY) return "portland";
  if (!city) {
    // No city: fall back on the point. North of Woodburn and within 30 miles
    // of Oregon City is the metro.
    const at = point(place);
    if (at && at.lat >= 45.2 && milesBetween(at, OREGON_CITY) <= 30) return "portland";
  }
  const minutes = city ? estimateDriveMinutes(city) : null;
  if (minutes != null && minutes <= LOCAL_MAX_MINUTES) return "local";
  return "regional";
}

/** Miles from Oregon City, from the geocode when there is one, else the city table; null if neither. */
export function milesFromOregonCity(place: MarketPlace): number | null {
  const at = point(place);
  if (at) return milesBetween(at, OREGON_CITY);
  return PORTLAND_MILES_FROM_OREGON_CITY[normalizeCity(place.city)] ?? null;
}

/**
 * The Portland tab's nearness bands, the counterpart of the Leads page's
 * drive bands from Winston: Oregon City and its neighbours (West Linn, Lake
 * Oswego, Milwaukie), then inner Portland / Tigard / Gresham, then Beaverton
 * to Hillsboro and Newberg, then the edges. Unknown sorts last.
 */
export function portlandBand(place: MarketPlace): number {
  const miles = milesFromOregonCity(place);
  if (miles == null) return 4;
  return miles <= 10 ? 0 : miles <= 18 ? 1 : miles <= 28 ? 2 : 3;
}

/** Parses a `?market=` value; anything else is null. */
export function parseMarket(value: string | string[] | null | undefined): Market | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "local" || v === "regional" || v === "portland" ? v : null;
}

/**
 * Rough drive minutes from Oregon City, from straight-line miles: metro roads
 * wind about 1.3x the straight line at ~45 mph, plus a few minutes getting
 * going (12 mi to downtown Portland ≈ 25 min, 21 mi to Hillsboro ≈ 40).
 */
function minutesFromOregonCity(miles: number): number {
  return Math.round((5 + miles * 1.6) / 5) * 5;
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `~${Math.max(5, minutes)} min`;
  const m = minutes % 60;
  return `~${Math.floor(minutes / 60)}h${m ? ` ${m}m` : ""}`;
}

/**
 * The drive time a listing's card shows: from Winston for local and regional
 * listings (driveTime.ts), from the Oregon City photographer for Portland
 * ones, so a Portland card doesn't read "~3h drive".
 */
export function listingDriveTime(place: MarketPlace): string | null {
  if (marketFor(place) === "portland") {
    const miles = milesFromOregonCity(place);
    return miles == null ? null : `${durationLabel(minutesFromOregonCity(miles))} from Oregon City`;
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

/** What a Portland-market agent's portfolio page names as their area: "Real estate photo & video in the Portland area". */
export const PORTLAND_AREA = "the Portland area";

/** Every Portland-market city name the app knows (lowercase), for the Portland portfolio template's towns. */
export function portlandTowns(): string[] {
  return Object.keys(PORTLAND_MILES_FROM_OREGON_CITY);
}
