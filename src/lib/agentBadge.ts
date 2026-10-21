// Scores an agent by volume, price and distance — Lukas's own ranking
// (2026-10-21): local beats everything; after that, high volume beats high
// price; price only matters once volume is low; and low-volume, low-price,
// far away is last. One function so the Follow up feeds, Agents list and
// AgentCard badge all rank and label the same way.

import { estimateDriveMinutes } from "./driveTime";

/** Below this many listings a year, "high volume" isn't earned. Half the typical full-time pace. */
const HIGH_VOLUME_PER_YEAR = 8;
/** Above this average sale price, a market is "high price" even at low volume. Regional, round. */
const HIGH_PRICE = 500_000;
/** "In town": the same local band the Leads page's drive-time bands use. */
const LOCAL_MINUTES = 45;
/** "A few hours away": short/medium drives don't count as far for this ranking, a multi-hour trip does. */
const FAR_MINUTES = 165;

export type AgentTier = "local" | "high_volume_far" | "high_price_low_volume" | "low_volume_far" | "unknown";

export interface AgentScore {
  tier: AgentTier;
  /** Lower sorts first: local, then high-volume-far, then high-price-low-volume, then low-volume-far. */
  rank: number;
  label: string;
  volumePerYear: number | null;
  avgPrice: number | null;
  driveMinutes: number | null;
}

const TIER_RANK: Record<AgentTier, number> = { local: 0, high_volume_far: 1, high_price_low_volume: 2, low_volume_far: 3, unknown: 4 };

/**
 * A hand-entered or homes.com-captured figure wins over one computed from
 * our own partial listing history — same "deliberate value wins" rule as
 * resolveAvgDaysBetweenListings (stats.ts), just with homes.com added as a
 * middle tier between a manual entry and our own count.
 */
export function resolveAgentVolume(agent: {
  avgListingsPerYear: number | null;
  homesListingsPerYear: number | null;
}): number | null {
  return agent.avgListingsPerYear ?? agent.homesListingsPerYear;
}

export function resolveAgentPrice(agent: { avgListingPrice: number | null; homesAvgSalePrice: number | null }): number | null {
  return agent.avgListingPrice ?? agent.homesAvgSalePrice;
}

export function scoreAgent(agent: {
  city?: string | null;
  avgListingsPerYear: number | null;
  avgListingPrice: number | null;
  homesListingsPerYear: number | null;
  homesAvgSalePrice: number | null;
}): AgentScore {
  const volumePerYear = resolveAgentVolume(agent);
  const avgPrice = resolveAgentPrice(agent);
  const driveMinutes = agent.city ? estimateDriveMinutes(agent.city) : null;

  const local = driveMinutes != null && driveMinutes <= LOCAL_MINUTES;
  const far = driveMinutes == null || driveMinutes > FAR_MINUTES;
  const highVolume = volumePerYear != null && volumePerYear >= HIGH_VOLUME_PER_YEAR;
  const highPrice = avgPrice != null && avgPrice >= HIGH_PRICE;

  let tier: AgentTier;
  let label: string;
  if (local) {
    tier = "local";
    label = highVolume ? "Local · high volume" : "Local";
  } else if (highVolume) {
    tier = "high_volume_far";
    label = far ? "High volume · far" : "High volume";
  } else if (highPrice) {
    tier = "high_price_low_volume";
    label = "High price, low volume";
  } else if (volumePerYear != null || avgPrice != null) {
    tier = "low_volume_far";
    label = "Low volume, far";
  } else {
    tier = "unknown";
    label = "No volume data yet";
  }

  return { tier, rank: TIER_RANK[tier], label, volumePerYear, avgPrice, driveMinutes };
}
