/**
 * Is a shoot's address in controlled airspace? Part 107.41 needs ATC
 * authorization (LAANC, or a DroneZone request where LAANC isn't offered)
 * to fly in Class B, C or D, or in a Class E surface area. A Klamath Falls
 * job turned out to sit in Class D next to the airport and nobody noticed
 * until he was on site, so every booking with an address is now checked.
 *
 * Free, no key: OpenStreetMap's Nominatim finds the spot (same lookup as the
 * mileage estimate, see ./finance/route.ts), then two FAA layers on ArcGIS
 * answer for that point: the class airspace shapes, and the UAS facility
 * map grid (the max altitude LAANC can approve, and whether the airport
 * offers LAANC at all). A failed check returns null and is only logged:
 * it must never stop a booking from saving.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings, listings, type AirspaceCheck } from "@/db/schema";
import { geocode } from "./finance/route";

export type { AirspaceCheck };

const FAA = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services";
const CLASS_AIRSPACE = `${FAA}/Class_Airspace/FeatureServer/0/query`;
const FACILITY_MAP = `${FAA}/FAA_UAS_FacilityMap_Data/FeatureServer/0/query`;

interface ClassFeature {
  NAME: string | null;
  CLASS: string | null;
  LOCAL_TYPE: string | null;
  LOWER_VAL: number | null;
}

interface GridFeature {
  CEILING: number | null;
  APT1_NAME: string | null;
  APT1_FAAID: string | null;
  APT1_LAANC: number | null;
}

async function pointQuery<T>(layer: string, lng: number, lat: number): Promise<T[]> {
  const url = new URL(layer);
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`FAA layer answered ${res.status}`);
  // ArcGIS reports errors with a 200 and an `error` body.
  const data = (await res.json()) as { features?: { attributes: T }[]; error?: { message?: string } };
  if (!data.features) throw new Error(`FAA layer error: ${data.error?.message ?? "no features"}`);
  return data.features.map((f) => f.attributes);
}

/** "KLAMATH FALLS CLASS D" -> "Klamath Falls Class D" (class letters stay capitals). */
function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bClass (\w+)/, (_, cls: string) => `Class ${cls.toUpperCase()}`);
}

const CLASS_ORDER = ["B", "C", "D", "E"];

function summarize(check: Omit<AirspaceCheck, "summary">): string {
  const where = check.approximate ? " Checked the town center (the street isn't on the map), so confirm the exact spot." : "";
  if (check.status === "uncontrolled") return `Uncontrolled (Class G): fly up to 400 ft.${where}`;

  const name = check.airspaces[0]?.name ?? `${check.airport?.name ?? "Airport"} controlled airspace`;
  let action: string;
  if (check.laanc && check.ceilingFt) {
    action = `Get a LAANC authorization in a LAANC app before flying (up to ${check.ceilingFt} ft here).`;
  } else if (check.laanc) {
    action = "The FAA map allows 0 ft here, so LAANC can't approve it: file a DroneZone authorization before flying.";
  } else if (check.laanc === null) {
    // In the airspace but outside the facility map's grid (rare).
    action = "Get an authorization (LAANC or DroneZone) before flying.";
  } else {
    action = "LAANC isn't available here: file a DroneZone authorization before flying.";
  }
  return `${name}. ${action}${where}`;
}

/**
 * The airspace at an address ("111 Hunter Ct, Klamath Falls, OR"). Falls back
 * to the town when OpenStreetMap doesn't know the street, and says so.
 * Null when the spot can't be found or the FAA's layers don't answer.
 */
export async function checkAirspace(address: string): Promise<AirspaceCheck | null> {
  try {
    // "Round Lake Rd (lot, across from the golf club)": the note confuses the geocoder.
    const query = address.replace(/\([^)]*\)/g, "").replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim();
    let point = await geocode(query);
    let approximate = false;
    const town = query.includes(",") ? query.slice(query.indexOf(",") + 1).trim() : null;
    if (!point && town) {
      // Nominatim asks for at most one request a second.
      await new Promise((r) => setTimeout(r, 1100));
      point = await geocode(town);
      approximate = point != null;
    }
    if (!point) {
      console.warn(`[airspace] couldn't find "${address}" on the map`);
      return null;
    }
    const [lng, lat] = point;

    const [classes, grid] = await Promise.all([
      pointQuery<ClassFeature>(CLASS_AIRSPACE, lng, lat),
      pointQuery<GridFeature>(FACILITY_MAP, lng, lat),
    ]);

    // Only airspace that starts at the surface matters at 400 ft: Class B, C,
    // D, and Class E surface areas (E2, and the E3/E4 extensions). The Class E
    // that starts at 700 or 1,200 ft, and Class A, are overhead, not here.
    const airspaces = classes
      .filter((c) => c.CLASS && CLASS_ORDER.includes(c.CLASS) && (c.LOWER_VAL ?? 0) === 0)
      .sort((a, b) => CLASS_ORDER.indexOf(a.CLASS!) - CLASS_ORDER.indexOf(b.CLASS!))
      .map((c) => ({
        name: titleCase(c.NAME ?? `Class ${c.CLASS}`),
        class: c.CLASS === "E" && c.LOCAL_TYPE?.startsWith("CLASS_") ? c.LOCAL_TYPE.slice(6) : c.CLASS!,
      }));

    // The facility map only covers airspace that needs authorization, so a grid
    // cell alone is enough to call it controlled.
    const cell = grid[0] ?? null;
    const result: Omit<AirspaceCheck, "summary"> = {
      status: airspaces.length > 0 || cell ? "controlled" : "uncontrolled",
      airspaces,
      ceilingFt: cell?.CEILING ?? null,
      laanc: cell ? cell.APT1_LAANC === 1 : null,
      airport: cell?.APT1_FAAID ? { name: cell.APT1_NAME ?? cell.APT1_FAAID, id: cell.APT1_FAAID } : null,
      lat,
      lng,
      approximate,
      place: address,
    };
    return { ...result, summary: summarize(result) };
  } catch (err) {
    console.error(`[airspace] check failed for "${address}":`, err);
    return null;
  }
}

/** The address a booking's airspace is checked at: its listing's when it has one. Null without a street address. */
export async function bookingPlace(bookingId: string): Promise<string | null> {
  const [row] = await db
    .select({
      address: bookings.address,
      city: bookings.city,
      state: bookings.state,
      listingAddress: listings.address,
      listingCity: listings.city,
      listingState: listings.state,
    })
    .from(bookings)
    .leftJoin(listings, eq(listings.id, bookings.listingId))
    .where(eq(bookings.id, bookingId));
  if (!row) return null;
  const address = (row.listingAddress ?? row.address)?.trim();
  // A city alone would only check the town center: not worth a warning either way.
  if (!address) return null;
  const city = row.listingCity ?? row.city;
  const state = row.listingState ?? row.state ?? "OR";
  return [address, city, state].filter(Boolean).join(", ");
}

/**
 * Checks a booking's airspace and saves it (bookings.airspace). Skips the
 * lookup when the address hasn't changed since the last good check, unless
 * forced ("Check again"). A failed check clears a result for an old address
 * but keeps one for this same address: a flaky lookup shouldn't erase a
 * Class D warning. Returns the saved check, or null when there's nothing.
 */
export async function refreshBookingAirspace(bookingId: string, { force = false } = {}): Promise<AirspaceCheck | null> {
  try {
    const place = await bookingPlace(bookingId);
    const [current] = await db.select({ airspace: bookings.airspace }).from(bookings).where(eq(bookings.id, bookingId));
    if (!current) return null;
    const previous = current.airspace;

    if (!place) {
      if (previous) await db.update(bookings).set({ airspace: null, airspaceCheckedAt: null }).where(eq(bookings.id, bookingId));
      return null;
    }
    if (!force && previous?.place === place) return previous;

    const check = await checkAirspace(place);
    if (!check && previous?.place === place) return previous;
    // Checked-at with no result means the check ran and failed: the detail view offers "Check again".
    await db.update(bookings).set({ airspace: check, airspaceCheckedAt: new Date() }).where(eq(bookings.id, bookingId));
    return check;
  } catch (err) {
    console.error(`[airspace] couldn't save the check for booking ${bookingId}:`, err);
    return null;
  }
}
