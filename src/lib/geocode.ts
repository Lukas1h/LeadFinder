/**
 * Where a listing or booking is on the map, for the "Shot one near you" feed:
 * matching shoots to nearby listings needs a real point, not just a town.
 *
 * The free US Census single-address geocoder does the first lookup; when it
 * has no match, OpenStreetMap's Nominatim (the same lookup the mileage
 * estimate uses, see ./finance/route.ts) tries the full street address. A
 * town-center fallback is deliberately not attempted — a point in the middle
 * of town is useless for "near" matching — so no match is stored as
 * geocodedAt set with lat/lng null. Nothing here ever throws: a failed lookup
 * must never stop a sync or a booking from saving.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bookings, listings } from "@/db/schema";
import { geocode } from "./finance/route";
import { bookingPlace } from "./airspace";

const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations";

export interface GeocodedPoint {
  lat: number;
  lng: number;
  source: "census" | "osm";
}

/** Nominatim asks for at most one request a second. */
function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** "1181 Alameda Dr (the blue house)" -> "1181 Alameda Dr": notes confuse the geocoders. */
function cleanStreet(street: string): string {
  return street
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A Census geocoder answer, or null when it knows no such address. */
async function censusLookup(
  collection: "address" | "onelineaddress",
  params: Record<string, string>
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL(`${CENSUS}/${collection}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    result?: { addressMatches?: { coordinates?: { x?: number; y?: number } }[] };
  };
  const coords = data.result?.addressMatches?.[0]?.coordinates;
  // The Census returns { x: lng, y: lat }.
  if (typeof coords?.x !== "number" || typeof coords?.y !== "number") return null;
  if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y)) return null;
  return { lat: coords.y, lng: coords.x };
}

/** The Census first, OpenStreetMap's Nominatim as fallback. Null when neither knows the address. */
async function geocodeQuery(
  censusCollection: "address" | "onelineaddress",
  censusParams: Record<string, string>,
  osmQuery: string
): Promise<GeocodedPoint | null> {
  let censusPoint: { lat: number; lng: number } | null = null;
  try {
    censusPoint = await censusLookup(censusCollection, censusParams);
  } catch (err) {
    // A Census outage shouldn't skip the fallback; just note it.
    console.warn("[geocode] Census lookup failed:", err);
  }
  if (censusPoint) return { ...censusPoint, source: "census" };

  const osmPoint = await geocode(osmQuery);
  return osmPoint ? { lat: osmPoint[1], lng: osmPoint[0], source: "osm" } : null;
}

/**
 * Geocodes a street address. The Census single-address endpoint first; then
 * Nominatim with the full "street, city, state zip" (never the town alone).
 * Null when neither finds it; never throws.
 */
export async function geocodeAddress(a: {
  street: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): Promise<GeocodedPoint | null> {
  const street = cleanStreet(a.street ?? "");
  if (!street) return null;

  const city = a.city?.trim() || null;
  const state = a.state?.trim() || "OR";
  const zip = a.zip?.trim() || null;

  try {
    const params: Record<string, string> = { street, state };
    if (city) params.city = city;
    if (zip) params.zip = zip;

    const query = [street, [city, state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return await geocodeQuery("address", params, query);
  } catch (err) {
    console.warn(`[geocode] couldn't geocode "${a.street}":`, err);
    return null;
  }
}

/**
 * Geocodes the given listings, one at a time, and saves each row's lat/lng
 * (geocodedAt always set; lat/lng null when no match). Rows without an
 * address are skipped unchanged. A pause follows a Nominatim fallback only,
 * where the service's 1-request-a-second rule applies. Never throws.
 */
export async function geocodeListings(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  try {
    const rows = await db
      .select({
        id: listings.id,
        address: listings.address,
        city: listings.city,
        state: listings.state,
        zipcode: listings.zipcode,
      })
      .from(listings)
      .where(inArray(listings.id, ids));

    let usedOsm = false;
    for (const row of rows) {
      if (!row.address?.trim()) continue;
      if (usedOsm) await pause(1100);

      const point = await geocodeAddress({
        street: row.address,
        city: row.city,
        state: row.state,
        zip: row.zipcode,
      });
      // Any result that isn't from the Census went through Nominatim, whether
      // or not it found a point, so the next lookup waits for its rate limit.
      usedOsm = point?.source !== "census";

      await db
        .update(listings)
        .set({
          lat: point?.lat ?? null,
          lng: point?.lng ?? null,
          geocodedAt: new Date(),
          geocodeSource: point?.source ?? null,
        })
        .where(eq(listings.id, row.id));
    }
  } catch (err) {
    console.warn("[geocode] couldn't geocode the listings:", err);
  }
}

/**
 * Geocodes a booking's address — its linked listing's when it has one (see
 * bookingPlace) — and saves lat/lng. Uses the Census one-line endpoint, since
 * the address arrives as a single "street, city, state" string. A booking
 * with no usable address gets its position cleared. Never throws.
 */
export async function geocodeBooking(bookingId: string): Promise<void> {
  try {
    const place = await bookingPlace(bookingId);
    if (!place) {
      await db
        .update(bookings)
        .set({ lat: null, lng: null, geocodedAt: null, geocodeSource: null })
        .where(eq(bookings.id, bookingId));
      return;
    }

    const point = await geocodeQuery("onelineaddress", { address: place }, place);
    await db
      .update(bookings)
      .set({
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        geocodedAt: new Date(),
        geocodeSource: point?.source ?? null,
      })
      .where(eq(bookings.id, bookingId));
  } catch (err) {
    console.warn(`[geocode] couldn't geocode booking ${bookingId}:`, err);
  }
}
