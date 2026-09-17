// Below this many listings, a single gap (or none at all) isn't a
// meaningful average — the agent detail views show nothing rather than a
// misleadingly precise number.
export const MIN_LISTINGS_FOR_AVG_GAP = 3;

/**
 * Average days between this agent's listings, computed from our own
 * tracked listings — unlike avgListingsPerYear/avgListingPrice on the
 * Agent row (those come from outside data Lukas enters by hand), this is
 * derived on the fly and never stored, so it's always current as of
 * whatever listings are passed in. Takes just the two date fields
 * (rather than a full Listing) so MCP tool queries that only select those
 * columns can reuse this without fetching full rows.
 */
export function averageDaysBetweenListings(listings: { listedAt: Date | null; foundAt: Date }[]): number | null {
  if (listings.length < MIN_LISTINGS_FOR_AVG_GAP) return null;

  const dates = listings.map((l) => (l.listedAt ?? l.foundAt).getTime()).sort((a, b) => a - b);

  let totalGapMs = 0;
  for (let i = 1; i < dates.length; i++) totalGapMs += dates[i] - dates[i - 1];

  const avgMs = totalGapMs / (dates.length - 1);
  return Math.round(avgMs / (1000 * 60 * 60 * 24));
}
