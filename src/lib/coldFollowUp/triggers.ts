import { db } from "@/db";
import { bookings, followUpPasses, listings, type Booking, type Listing } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getMarkets } from "@/lib/marketsData";
import type { Market } from "@/lib/markets";
import { getRecentShoots, milesBetween, nearestShoot, type NearShoot, type RecentShoot } from "@/lib/nearShoots";
import { shotAddresses, shotByHim, stillActive } from "@/app/follow-up/feeds/shared";
import { COLD_TRIGGERS, loadColdPool, type ColdPoolAgent, type ColdTrigger } from "./pool";

/**
 * Why a cold agent is worth one more text. Each trigger is a fact about the
 * world, not about them: a home he just shot nearby, a job he is doing in
 * their area this week, or a listing they put up since he last texted.
 *
 * Strongest first (COLD_TRIGGERS order) and one candidate per agent, because
 * sending two of these in the same week is exactly the pestering the 21-day
 * floor exists to prevent. The trigger is only the excuse: which tab the card
 * lands on (and so which pitch it sends) is the text's own question, decided
 * in messages.ts.
 *
 * - near_shoot: one of their active listings is within range of a home he
 *   shot in the last 30 days (getRecentShoots/nearestShoot — 1 mile in town,
 *   3 in the country), so the text can open with the shoot.
 * - in_area: a job he shot in the last 10 days within 15 miles of one of their
 *   listings, outside the local market ("I was in the Eugene area and shot a
 *   listing the other day"). Past jobs only: the second text offers photos
 *   from that shoot. Local agents only get near_shoot, since around Roseburg
 *   he is always "in the area" (Lukas, 2026-11-15).
 *
 * Both shoot triggers prefer a shoot marked Showcase (bookings.showcase,
 * 2026-11-15): it wins over a nearer one that isn't, because that is the shoot
 * he is happy to show and the pitch asks about it (messages.ts). A shoot that
 * isn't Showcase still works as the excuse — it just gets the soft pitch.
 * - new_listing: they listed something since his text, so the text has a
 *   reason that is squarely about them.
 *
 * Passes are honoured the way every Follow up feed honours them: a pass on any
 * cold feed covers the agent on all of them for good without a listing, and
 * covers that listing on all of them with one (follow_up_passes). The tabs are
 * pitches now, not reasons, so a pass on one is not about the excuse.
 */

export interface ColdCandidate extends ColdPoolAgent {
  trigger: ColdTrigger;
  /** The listing the excuse is about. */
  listing: Listing;
  /** The shoot/job the trigger points at; null for new_listing. */
  shoot: {
    bookingId: string;
    address: string;
    city: string | null;
    miles: number;
    date: string;
    /** Marked Showcase on the booking: the pitch asks to share pics from it (messages.ts). */
    showcase: boolean;
  } | null;
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
  /** Marked Showcase on the booking (bookings.showcase). */
  showcase: boolean;
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
      showcase: b.showcase,
      at: when,
      ...point,
    });
  }
  return jobs;
}

/**
 * `triggers` narrows the run to a subset of the excuses (default: all of them),
 * for a page that only draws candidates from one. A trigger left out is
 * skipped entirely, so its agent falls through to the next trigger that is on —
 * the strongest-first order above still decides which excuse a card leads with.
 */
export async function getColdFollowUpCandidates(
  now = Date.now(),
  triggers: readonly ColdTrigger[] = COLD_TRIGGERS
): Promise<ColdCandidate[]> {
  const pool = await loadColdPool(now);
  if (pool.length === 0) return [];
  const ids = pool.map((p) => p.agent.id);

  const [mk, agentListings, shoots, shot, passes, areaJobs] = await Promise.all([
    getMarkets(),
    db.select().from(listings).where(inArray(listings.agentId, ids)),
    getRecentShoots(now),
    shotAddresses(),
    db
      .select({ agentId: followUpPasses.agentId, listingId: followUpPasses.listingId })
      .from(followUpPasses)
      .where(
        and(
          inArray(followUpPasses.agentId, ids),
          sql`left(coalesce(${followUpPasses.feed}, ''), 5) = 'cold_'`
        )
      ),
    loadAreaJobs(now),
  ]);

  const listingsByAgent = new Map<string, Listing[]>();
  for (const listing of agentListings) {
    if (!listing.agentId) continue;
    const list = listingsByAgent.get(listing.agentId) ?? [];
    list.push(listing);
    listingsByAgent.set(listing.agentId, list);
  }

  // A pass anywhere in the cold tabs covers the agent everywhere; a pass on a
  // listing covers that listing in every tab.
  const passedAgent = new Set<string>();
  const passedListing = new Set<string>();
  for (const pass of passes) {
    if (pass.listingId) passedListing.add(`${pass.agentId}|${pass.listingId}`);
    else passedAgent.add(pass.agentId);
  }

  const candidates: ColdCandidate[] = [];
  const push = (
    entry: ColdPoolAgent,
    trigger: ColdTrigger,
    listing: Listing,
    shoot: ColdCandidate["shoot"]
  ) => {
    candidates.push({ ...entry, trigger, listing, shoot, market: mk.marketFor(listing) });
  };

  for (const entry of pool) {
    const agentId = entry.agent.id;
    if (passedAgent.has(agentId)) continue;

    const usable = (listingsByAgent.get(agentId) ?? []).filter(
      (listing) =>
        !passedListing.has(`${agentId}|${listing.id}`) && stillActive(listing) && !shotByHim(listing, shot)
    );

    // 1. A listing near a home he just shot. Same test as the "Shot one near
    //    you" feed (feeds/nearShoot.ts), one card per agent.
    if (triggers.includes("near_shoot") && shoots.length > 0) {
      // Nearest (listing, shoot) pair among `candidates`; a Showcase shoot is
      // the better excuse even when a nearer shoot isn't one.
      const bestPair = (candidates: RecentShoot[]): { listing: Listing; near: NearShoot } | null => {
        let best: { listing: Listing; near: NearShoot } | null = null;
        for (const listing of usable) {
          const near = nearestShoot(listing, candidates, shot);
          if (!near) continue;
          if (!best || near.miles < best.near.miles) best = { listing, near };
        }
        return best;
      };
      const showcaseShoots = shoots.filter((shoot) => shoot.showcase);
      const best =
        (showcaseShoots.length > 0 ? bestPair(showcaseShoots) : null) ?? bestPair(shoots);
      if (best) {
        const { listing, near } = best;
        push(entry, "near_shoot", listing, {
          bookingId: near.shoot.bookingId,
          address: near.shoot.address,
          city: near.shoot.city,
          miles: near.miles,
          date: ymd(near.shoot.shotAt),
          showcase: near.shoot.showcase,
        });
        continue;
      }
    }

    // 2. A job he shot in their (non-local) area in the last few days.
    if (triggers.includes("in_area") && areaJobs.length > 0) {
      // Same preference as near_shoot: a job marked Showcase wins over a nearer one.
      const bestPair = (onlyShowcase: boolean): { listing: Listing; job: AreaJob; miles: number } | null => {
        let best: { listing: Listing; job: AreaJob; miles: number } | null = null;
        for (const listing of usable) {
          // Never the local market: around Roseburg he is always "in the area".
          if (mk.marketFor(listing) === "local") continue;
          const point = usablePoint(listing);
          if (!point) continue;
          for (const job of areaJobs) {
            if (onlyShowcase && !job.showcase) continue;
            const miles = milesBetween(point, job);
            if (miles > IN_AREA_MILES) continue;
            if (!best || miles < best.miles) best = { listing, job, miles };
          }
        }
        return best;
      };
      const best =
        (areaJobs.some((job) => job.showcase) ? bestPair(true) : null) ?? bestPair(false);
      if (best) {
        const { listing, job, miles } = best;
        push(entry, "in_area", listing, {
          bookingId: job.bookingId,
          address: job.address,
          city: job.city,
          miles,
          date: ymd(job.at),
          showcase: job.showcase,
        });
        continue;
      }
    }

    // 3. Something they listed since his text, fresh enough to mention.
    if (triggers.includes("new_listing")) {
      const freshSince = now - NEW_LISTING_DAYS * DAY;
      let newest: { listing: Listing; at: Date } | null = null;
      for (const listing of usable) {
        const at = listing.listedAt ?? listing.foundAt;
        // After his text, so it's news to them and not the listing he already pitched.
        if (at.getTime() <= entry.lastTextedAt.getTime()) continue;
        if (at.getTime() < freshSince) continue;
        if (!newest || at > newest.at) newest = { listing, at };
      }
      if (newest) push(entry, "new_listing", newest.listing, null);
    }
  }

  // Strongest trigger first, then whoever has been waiting longest.
  candidates.sort(
    (a, b) =>
      COLD_TRIGGERS.indexOf(a.trigger) - COLD_TRIGGERS.indexOf(b.trigger) ||
      a.lastTextedAt.getTime() - b.lastTextedAt.getTime()
  );
  return candidates;
}
