import { db } from "@/db";
import { bookings, listings } from "@/db/schema";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { addressKey } from "@/app/follow-up/data";
import { shotAddresses } from "@/app/follow-up/feeds/shared";

/**
 * "Shot one near you": which of his recent shoots is close to a listing, so a
 * text can open with "I just shot a home a few blocks from your listing on
 * Olive St" (the Follow Up tab, warm agents) or a cold lead can be led with it
 * (the Leads page's "Near your shoots" section).
 *
 * Points come from listings/bookings lat/lng (src/lib/geocode.ts); a booking
 * linked to a listing uses the listing's point. Radius picked from the data
 * on 2026-11-10 (scripts/analyze-shoot-proximity.mts): in town 1 mile already
 * finds 10–20 active listings, while a rural shoot has 0–2 listings within a
 * mile, so a shoot with fewer than DENSE_LISTINGS listings of any status within
 * a mile is rural and gets RURAL_MILES instead.
 *
 * A point that matched only the street, not the house (geocodeSource
 * "osm_street": often a long country road's midpoint), is never used.
 */

export const TOWN_MILES = 1;
export const RURAL_MILES = 3;
/** Fewer listings than this within TOWN_MILES of a shoot = a rural shoot. */
const DENSE_LISTINGS = 5;
/** "Just shot" has to be true. */
export const RECENT_SHOOT_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export interface RecentShoot {
  bookingId: string;
  /** The listing it was booked for, if any. */
  listingId: string | null;
  address: string;
  city: string | null;
  shotAt: Date;
  /** Who booked it: never pitched their own shoot. */
  contactAgentId: string | null;
  lat: number;
  lng: number;
  radiusMiles: number;
}

export interface NearShoot {
  shoot: RecentShoot;
  miles: number;
}

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

/** A usable point: geocoded to the house, not just the street. */
function point(row: { lat: number | null; lng: number | null; geocodeSource: string | null }) {
  if (row.lat == null || row.lng == null || row.geocodeSource === "osm_street") return null;
  return { lat: row.lat, lng: row.lng };
}

/**
 * Shoots he has done (marked shot, completed, invoiced or paid) in the last
 * RECENT_SHOOT_DAYS, with a usable point and the radius that fits the area.
 */
export async function getRecentShoots(now = Date.now()): Promise<RecentShoot[]> {
  const rows = await db
    .select({
      id: bookings.id,
      listingId: bookings.listingId,
      address: bookings.address,
      city: bookings.city,
      jobDate: bookings.jobDate,
      shotAt: bookings.shotAt,
      completedAt: bookings.completedAt,
      invoicedAt: bookings.invoicedAt,
      invoiceSentAt: bookings.invoiceSentAt,
      paidAt: bookings.paidAt,
      contactAgentId: bookings.contactAgentId,
      lat: bookings.lat,
      lng: bookings.lng,
      geocodeSource: bookings.geocodeSource,
      listingAddress: listings.address,
      listingCity: listings.city,
      listingLat: listings.lat,
      listingLng: listings.lng,
      listingGeocodeSource: listings.geocodeSource,
    })
    .from(bookings)
    .leftJoin(listings, eq(listings.id, bookings.listingId))
    .where(
      or(
        isNotNull(bookings.shotAt),
        isNotNull(bookings.completedAt),
        isNotNull(bookings.invoicedAt),
        isNotNull(bookings.invoiceSentAt),
        isNotNull(bookings.paidAt)
      )
    );

  const shoots: Omit<RecentShoot, "radiusMiles">[] = [];
  for (const r of rows) {
    // When it was shot: the job day, else the first mark that it was done.
    const when = r.jobDate ?? r.shotAt ?? r.completedAt ?? r.invoiceSentAt ?? r.invoicedAt ?? r.paidAt;
    if (!when || now - when.getTime() > RECENT_SHOOT_DAYS * DAY || when.getTime() > now) continue;
    const p =
      point(r) ?? point({ lat: r.listingLat, lng: r.listingLng, geocodeSource: r.listingGeocodeSource });
    const address = (r.listingAddress ?? r.address)?.trim();
    if (!p || !address) continue;
    shoots.push({
      bookingId: r.id,
      listingId: r.listingId,
      address,
      city: r.listingCity ?? r.city,
      shotAt: when,
      contactAgentId: r.contactAgentId,
      ...p,
    });
  }
  if (shoots.length === 0) return [];

  // How built-up the area is: listings of any status within TOWN_MILES.
  const all = await db
    .select({ lat: listings.lat, lng: listings.lng, geocodeSource: listings.geocodeSource })
    .from(listings)
    .where(and(isNotNull(listings.lat), isNotNull(listings.lng)));
  const points = all.map(point).filter((p): p is { lat: number; lng: number } => p != null);
  return shoots.map((s) => {
    const dense = points.filter((p) => milesBetween(s, p) <= TOWN_MILES).length;
    return { ...s, radiusMiles: dense >= DENSE_LISTINGS ? TOWN_MILES : RURAL_MILES };
  });
}

/**
 * The nearest recent shoot within its radius of this listing, or null. Never
 * the listing's own shoot, a home he shot (shotKeys: addressKey of every
 * booking address), or a shoot booked by the listing's own agent.
 */
export function nearestShoot(
  listing: { id: string; address: string | null; lat: number | null; lng: number | null; geocodeSource: string | null; agentId: string | null; bookingId?: string | null },
  shoots: RecentShoot[],
  shotKeys: Set<string>
): NearShoot | null {
  const p = point(listing);
  if (!p || listing.bookingId) return null;
  const key = addressKey(listing.address);
  if (key && shotKeys.has(key)) return null;
  let best: NearShoot | null = null;
  for (const shoot of shoots) {
    if (shoot.listingId === listing.id) continue;
    if (listing.agentId && shoot.contactAgentId === listing.agentId) continue;
    if (key && addressKey(shoot.address) === key) continue;
    const miles = milesBetween(shoot, p);
    if (miles <= shoot.radiusMiles && (!best || miles < best.miles)) best = { shoot, miles };
  }
  return best;
}

/** "a few blocks from" / "just down the road from" / "near": how to say the distance in a text. */
export function distancePhrase(miles: number): string {
  if (miles < 0.4) return "a few blocks from";
  if (miles < 1.2) return "just down the road from";
  return "not far from";
}

/** "0.3 mi" / "2.1 mi". */
export function milesLabel(miles: number): string {
  return `${miles < 0.1 ? "<0.1" : miles.toFixed(1)} mi`;
}

/**
 * Whether this one listing is near a recent shoot, for the Send dialog's
 * template pick (a template can target the Leads page's "Near your shoots").
 */
export async function isNearRecentShoot(listing: Parameters<typeof nearestShoot>[0]): Promise<boolean> {
  if (listing.lat == null || listing.lng == null) return false;
  const [shoots, shot] = await Promise.all([getRecentShoots(), shotAddresses()]);
  return nearestShoot(listing, shoots, shot) != null;
}
