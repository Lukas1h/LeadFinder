/**
 * Does this agent already have a regular photographer?
 *
 * The photo-quality score says how professional a listing's photos look (see
 * the `score` comment in src/db/schema.ts: 1-10, HIGHER = more clearly
 * professional). One high-scoring listing could be a fluke — a builder's stock
 * shoot, a friend with a camera — so the signal is the *average* across an
 * agent's listings, weighted toward the recent ones: agents change
 * photographers, and a listing from two years ago says little about who shoots
 * their listings today. A high average means someone is already shooting for
 * them (a cold pitch has to beat that); a low average means nobody is.
 *
 * Used to split the cold-text list into "no photographer" (pitch the photos)
 * and "has photographer" (pitch something else, or skip).
 */

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { listings } from "@/db/schema";

export type ColdSegment = "has_photographer" | "no_photographer" | "unknown";

export interface AgentSegment {
  segment: ColdSegment;
  /** Recency-weighted mean of listings.score; null when nothing scored. */
  weightedScore: number | null;
  /** How many of their listings had a score (not the listing count). */
  scoredListings: number;
  /** Median price at or above HIGH_END_PRICE. False when no prices on file. */
  highEnd: boolean;
}

/** Recency-weighted mean score at or above this = already has a photographer. */
export const HAS_PHOTOGRAPHER_MIN_SCORE = 7;

/** Below this many scored listings, one score is not enough to judge. */
export const MIN_SCORED_LISTINGS = 1;

/**
 * With a single scored listing, the bar is higher: Gemini puts most listings
 * on 8, so one 7 says little (Lukas, 2026-11-15). Two or more use minScore.
 */
export const SINGLE_LISTING_MIN_SCORE = 8;

/**
 * A listing's weight halves every SCORE_HALF_LIFE_DAYS days of age, so a
 * listing from ~3 months ago counts half, 6 months a quarter, and so on.
 */
export const SCORE_HALF_LIFE_DAYS = 90;

// PLACEHOLDER: Lukas will set the real high-end line later.
export const HIGH_END_PRICE = 800_000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The slice of a listing this needs — a full drizzle `Listing` satisfies it. */
type SegmentRow = {
  score: number | null;
  price: number | null;
  listedAt: Date | null;
  foundAt: Date;
};

/**
 * Recency weight for one listing: 1 for something listed today, halving every
 * SCORE_HALF_LIFE_DAYS. Ages in the future (a bad listed_at) count as today
 * rather than gaining weight.
 */
function recencyWeight(ageDays: number): number {
  return 0.5 ** (Math.max(0, ageDays) / SCORE_HALF_LIFE_DAYS);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Classifies one agent from their listings.
 *
 * `now` is a timestamp in ms (Date.now() by default) so callers and tests can
 * pin the clock. `minScore` is the "has a photographer" line, overridable so
 * the threshold can be compared against real data before it's settled.
 */
export function segmentAgent(
  rows: SegmentRow[],
  now: number = Date.now(),
  minScore: number = HAS_PHOTOGRAPHER_MIN_SCORE,
): AgentSegment {
  const scored = rows.filter((row): row is SegmentRow & { score: number } => row.score !== null);

  let weightedSum = 0;
  let weightTotal = 0;
  for (const row of scored) {
    const at = row.listedAt ?? row.foundAt;
    const ageDays = (now - at.getTime()) / MS_PER_DAY;
    const weight = recencyWeight(ageDays);
    weightedSum += weight * row.score;
    weightTotal += weight;
  }
  const weightedScore = weightTotal > 0 ? weightedSum / weightTotal : null;

  const prices = rows
    .map((row) => row.price)
    .filter((price): price is number => price !== null);
  const medianPrice = median(prices);

  const segment: ColdSegment =
    weightedScore === null || scored.length < MIN_SCORED_LISTINGS
      ? "unknown"
      : weightedScore >= (scored.length === 1 ? Math.max(minScore, SINGLE_LISTING_MIN_SCORE) : minScore)
        ? "has_photographer"
        : "no_photographer";

  return {
    segment,
    weightedScore,
    scoredListings: scored.length,
    highEnd: medianPrice !== null && medianPrice >= HIGH_END_PRICE,
  };
}

/**
 * Segments several agents in one query. Agents with no listings (or an id not
 * on file) get an "unknown" segment rather than being left out of the map.
 */
export async function loadAgentSegments(
  agentIds: string[],
  now: number = Date.now(),
  minScore: number = HAS_PHOTOGRAPHER_MIN_SCORE,
): Promise<Map<string, AgentSegment>> {
  const segments = new Map<string, AgentSegment>();
  for (const id of agentIds) {
    segments.set(id, {
      segment: "unknown",
      weightedScore: null,
      scoredListings: 0,
      highEnd: false,
    });
  }
  if (agentIds.length === 0) return segments;

  const rows = await db
    .select({
      agentId: listings.agentId,
      score: listings.score,
      price: listings.price,
      listedAt: listings.listedAt,
      foundAt: listings.foundAt,
    })
    .from(listings)
    .where(inArray(listings.agentId, agentIds));

  const byAgent = new Map<string, SegmentRow[]>();
  for (const row of rows) {
    if (row.agentId === null) continue;
    const bucket = byAgent.get(row.agentId);
    if (bucket) bucket.push(row);
    else byAgent.set(row.agentId, [row]);
  }

  for (const [agentId, agentRows] of byAgent) {
    segments.set(agentId, segmentAgent(agentRows, now, minScore));
  }
  return segments;
}
