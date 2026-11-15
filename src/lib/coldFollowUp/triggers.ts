import { db } from "@/db";
import { bookings, followUpPasses, listings, type Booking, type Listing } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { marketFor, type Market } from "@/lib/markets";
import { getRecentShoots, milesBetween, nearestShoot, type NearShoot } from "@/lib/nearShoots";
import { shotAddresses, shotByHim, stillActive } from "@/app/follow-up/feeds/shared";
import { COLD_FEED_KEYS, loadColdPool, type ColdFeedKey, type ColdPoolAgent } from "./pool";

/**
 * Why a cold agent is worth one more text. Each trigger is a fact about the
 * world, not about them: a home he just shot nearby, a job he is doing in
 * their area this week, or a listing they put up since he last texted.
 *
 * Strongest first (COLD_FEED_KEYS order) and one candidate per agent, because
 * sending two of these in the same week is exactly the pestering the 21-day
 * floor exists to prevent.
 *
 * - cold_near_shoot: one of their active listings is within range of a home
 *   he shot in the last 30 days (getRecentShoots/nearestShoot — 1 mile in
 *   town, 3 in the country), so the text can open with the shoot.
 * - cold_in_area: a job he shot in the last 10 days within 15 miles of one of
 *   their listings, outside the local market ("I was in the Eugene area and
 *   shot a listing the other day"). Past jobs only: the second text offers
 *   photos from that shoot. Local agents only get cold_near_shoot, since
 *   around Roseburg he is always "in the area" (Lukas, 2026-11-15).
 * - cold_new_listing: they listed something since his text, so the text has a
 *   reason that is squarely about them.
 *
 * Passes are honoured the way every Follow up feed honours them: a pass with a
 * listing covers that listing in that feed only, one without covers the agent
 * in that feed for good (follow_up_passes).
 */

export interface ColdCandidate extends ColdPoolAgent {
  trigger: ColdFeedKey;
  /** The listing the excuse is about. */
  listing: Listing;
  /** The shoot/job the trigger points at; null for cold_new_listing. */
  shoot: { bookingId: string; address: string; city: string | null; miles: number; date: string } | null;
  market: Market;
}

const DAY = 24 * 60 * 60 * 1000;
const TZ = "America/Los_Angeles";
/** "He'll be in your area": a booking this close to one of their listings. */
const IN_AREA_MILES = 15;
/** How far back a shoot still reads as "the other day". */
const IN_AREA_DAYS = 10;
const NEW_LISTING_DAYS = 10;

/** "2026-11-15" in Pacific, the way a date reads on a card. */
function ymd(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}

/** A usable point: geocoded to the house, not just the street (as nearShoots.ts). */
function usablePoint(row: { lat: number | null; lng: number | null; geocodeSource: string | null }) {
  if (row.lat == null || row.lng == null || row.geocodeSource === "osm_street") return null;
  return { lat: row.lat, lng: row.lng };
}

/**
 * The bookings table has no cancellation state — cancelling a job deletes the
 * row — so the only cancellation signal that can exist here is the market
 * status the nightly check leaves on the property. Guard anyway, so a
 * withdrawn listing's job never counts as "in your area".
 */
function isCancelled(booking: Booking): boolean {
  return /cancel|withdraw|expired/i.test(booking.marketStatus ?? "");
}

interface AreaJob {
  bookingId: string;
  address: string;
  city: string | null;
  at: Date;
  lat: number;
  lng: number;
}

/** His jobs from the last IN_AREA_DAYS up to now (already shot), with a usable point. */
async function loadAreaJobs(now: number): Promise<AreaJob[]> {
  const from = new Date(now - IN_AREA_DAYS * DAY);
  const to = new Date(now);

  const rows = await db
    .select({
      booking: bookings,
      listingAddress: listings.address,
      listingCity: listings.city,
      listingLat: listings.lat,
      listingLng: listings.lng,
      listingGeocodeSource: listings.geocodeSource,
    })
    .from(bookings)
    .leftJoin(listings, eq(bookings.listingId, listings.id))
    // The shoot day; a job already marked shot without a date still counts.
    .where(sql`coalesce(${bookings.jobDate}, ${bookings.shotAt}) between ${from} and ${to}`);

  const jobs: AreaJob[] = [];
  for (const row of rows) {
    const b = row.booking;
    if (isCancelled(b)) continue;
    const when = b.jobDate ?? b.shotAt;
    if (!when) continue;
    const point =
      usablePoint(b) ??
      usablePoint({ lat: row.listingLat, lng: row.listingLng, geocodeSource: row.listingGeocodeSource });
    // A booking linked to a listing uses the listing's address, as everywhere else.
    const address = (row.listingAddress ?? b.address)?.trim();
    if (!point || !address) continue;
    jobs.push({
      bookingId: b.id,
      address,
      city: row.listingCity ?? b.city,
      at: when,
      ...point,
    });
  }
  return jobs;
}

/**
 * `triggers` narrows the run to a subset of the feeds (default: all of them),
 * for a page that only shows one cold tab. A trigger left out is skipped
 * entirely, so its agent falls through to the next trigger that is on — the
 * strongest-first order above still decides who gets which excuse.
 */
export async function getColdFollowUpCandidates(
  now = Date.now(),
  triggers: readonly ColdFeedKey[] = COLD_FEED_KEYS
): Promise<ColdCandidate[]> {
  const pool = await loadColdPool(now);
  if (pool.length === 0) return [];
  const ids = pool.map((p) => p.agent.id);

  const [agentListings, shoots, shot, passes, areaJobs] = await Promise.all([
    db.select().from(listings).where(inArray(listings.agentId, ids)),
    getRecentShoots(now),
    shotAddresses(),
    db
      .select({ agentId: followUpPasses.agentId, feed: followUpPasses.feed, listingId: followUpPasses.listingId })
      .from(followUpPasses)
      .where(and(inArray(followUpPasses.agentId, ids), inArray(followUpPasses.feed, [...COLD_FEED_KEYS]))),
    loadAreaJobs(now),
  ]);

  const listingsByAgent = new Map<string, Listing[]>();
  for (const listing of agentListings) {
    if (!listing.agentId) continue;
    const list = listingsByAgent.get(listing.agentId) ?? [];
    list.push(listing);
    listingsByAgent.set(listing.agentId, list);
  }

  const passedAgent = new Set<string>();
  const passedListing = new Set<string>();
  for (const pass of passes) {
    if (pass.listingId) passedListing.add(`${pass.agentId}|${pass.feed}|${pass.listingId}`);
    else passedAgent.add(`${pass.agentId}|${pass.feed}`);
  }

  const candidates: ColdCandidate[] = [];
  const push = (
    entry: ColdPoolAgent,
    trigger: ColdFeedKey,
    listing: Listing,
    shoot: ColdCandidate["shoot"]
  ) => {
    candidates.push({ ...entry, trigger, listing, shoot, market: marketFor(listing) });
  };

  for (const entry of pool) {
    const agentId = entry.agent.id;
    const allowed = (feed: ColdFeedKey, listingId: string) =>
      !passedAgent.has(`${agentId}|${feed}`) && !passedListing.has(`${agentId}|${feed}|${listingId}`);

    const usable = (listingsByAgent.get(agentId) ?? []).filter(
      (listing) => stillActive(listing) && !shotByHim(listing, shot)
    );

    // 1. A listing near a home he just shot. Same test as the "Shot one near
    //    you" feed (feeds/nearShoot.ts), one card per agent.
    if (triggers.includes("cold_near_shoot") && !passedAgent.has(`${agentId}|cold_near_shoot`) && shoots.length > 0) {
      let best: { listing: Listing; near: NearShoot } | null = null;
      for (const listing of usable) {
        if (!allowed("cold_near_shoot", listing.id)) continue;
        const near = nearestShoot(listing, shoots, shot);
        if (!near) continue;
        if (!best || near.miles < best.near.miles) best = { listing, near };
      }
      if (best) {
        const { listing, near } = best;
        push(entry, "cold_near_shoot", listing, {
          bookingId: near.shoot.bookingId,
          address: near.shoot.address,
          city: near.shoot.city,
          miles: near.miles,
          date: ymd(near.shoot.shotAt),
        });
        continue;
      }
    }

    // 2. A job he shot in their (non-local) area in the last few days.
    if (triggers.includes("cold_in_area") && !passedAgent.has(`${agentId}|cold_in_area`) && areaJobs.length > 0) {
      let best: { listing: Listing; job: AreaJob; miles: number } | null = null;
      for (const listing of usable) {
        if (!allowed("cold_in_area", listing.id)) continue;
        if (marketFor(listing) === "local") continue;
        const point = usablePoint(listing);
        if (!point) continue;
        for (const job of areaJobs) {
          const miles = milesBetween(point, job);
          if (miles > IN_AREA_MILES) continue;
          if (!best || miles < best.miles) best = { listing, job, miles };
        }
      }
      if (best) {
        const { listing, job, miles } = best;
        push(entry, "cold_in_area", listing, {
          bookingId: job.bookingId,
          address: job.address,
          city: job.city,
          miles,
          date: ymd(job.at),
        });
        continue;
      }
    }

    // 3. Something they listed since his text, fresh enough to mention.
    if (triggers.includes("cold_new_listing")) {
      const freshSince = now - NEW_LISTING_DAYS * DAY;
      let newest: { listing: Listing; at: Date } | null = null;
      for (const listing of usable) {
        if (!allowed("cold_new_listing", listing.id)) continue;
        const at = listing.listedAt ?? listing.foundAt;
        // After his text, so it's news to them and not the listing he already pitched.
        if (at.getTime() <= entry.lastTextedAt.getTime()) continue;
        if (at.getTime() < freshSince) continue;
        if (!newest || at > newest.at) newest = { listing, at };
      }
      if (newest) push(entry, "cold_new_listing", newest.listing, null);
    }
  }

  // Strongest trigger first, then whoever has been waiting longest.
  candidates.sort(
    (a, b) =>
      COLD_FEED_KEYS.indexOf(a.trigger) - COLD_FEED_KEYS.indexOf(b.trigger) ||
      a.lastTextedAt.getTime() - b.lastTextedAt.getTime()
  );
  return candidates;
}
