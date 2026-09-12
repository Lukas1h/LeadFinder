import type { Agent, Listing } from "@/db/schema";
import { daysSince } from "@/lib/format";

// Fewer than this many photos on the listing itself is as strong a signal
// as a bad photo-quality score — the agent likely hasn't hired anyone yet.
export const FEW_PHOTOS_THRESHOLD = 5;

// Photo scores run 0 (worst) to 10 (best) — see PhotoScoreBadge's tiers.
const MAX_PHOTO_SCORE = 10;

// A listing at this price sits at the middle of this market — its
// photo-opportunity weight is left untouched (1x). More expensive listings
// weigh their opportunity higher, cheaper ones lower, clamped so neither a
// mansion nor a starter home can swing more than ~2.5x either direction.
const PRICE_WEIGHT_BASELINE = 400_000;
const PRICE_WEIGHT_MIN = 0.5;
const PRICE_WEIGHT_MAX = 2.5;

// Recency decay is capped so an old listing never outweighs the coming-soon
// bonus below, or fully cancels out a strong photo/price opportunity — it's
// a soft "probably already handled" signal, not a hard disqualifier.
const AGE_PENALTY_PER_DAY = 0.15;
const AGE_PENALTY_MAX = 8;

// Coming-soon is worth more than the largest possible photo/price
// opportunity (10 * 2.5 = 25) — a listing that isn't live yet almost
// certainly hasn't had a photographer booked, which trumps every other
// signal here, same as it did as a hard top tier before this was a
// continuous score.
const COMING_SOON_BONUS = 100;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * How worth chasing a lead is, highest first. Combines:
 *  - Coming-soon status (dominant — see COMING_SOON_BONUS above).
 *  - Photo opportunity: how bad the current photos are (score) or how thin
 *    the listing is (very few photos counts the same as a bad score —
 *    both mean the agent likely hasn't hired anyone yet), scaled by price
 *    — an expensive listing with mediocre photos is worth more than a
 *    cheap one with terrible photos, since the job itself pays more.
 *  - Listing age: the longer it's been live, the more likely the agent
 *    already found a photographer (or gave up caring), so priority decays
 *    gently the older a listing gets.
 * Listings with neither a score nor a photo count (not yet scored) get no
 * photo-opportunity boost either way — they rank on coming-soon/age alone
 * until scoring catches up.
 */
export function leadPriorityScore(lead: Listing): number {
  let score = lead.isComingSoon ? COMING_SOON_BONUS : 0;

  const scoreOpportunity = lead.score != null ? MAX_PHOTO_SCORE - lead.score : 0;
  const fewPhotosOpportunity = lead.photoCount != null && lead.photoCount < FEW_PHOTOS_THRESHOLD ? MAX_PHOTO_SCORE : 0;
  const photoOpportunity = Math.max(scoreOpportunity, fewPhotosOpportunity);

  const priceWeight =
    lead.price != null ? clamp(lead.price / PRICE_WEIGHT_BASELINE, PRICE_WEIGHT_MIN, PRICE_WEIGHT_MAX) : 1;
  score += photoOpportunity * priceWeight;

  if (lead.listedAt) {
    score -= Math.min(daysSince(lead.listedAt) * AGE_PENALTY_PER_DAY, AGE_PENALTY_MAX);
  }

  return score;
}

export function byLeadPriority(a: Listing, b: Listing): number {
  return leadPriorityScore(b) - leadPriorityScore(a);
}

export function findDuplicateAgentContact(
  agentPhone: string | null,
  currentListingId: string,
  agentByPhone: Map<string, Agent>
): Agent | null {
  if (!agentPhone) return null;
  const agent = agentByPhone.get(agentPhone);
  if (!agent || !agent.lastContactedListingId) return null;
  if (agent.lastContactedListingId === currentListingId) return null;
  return agent;
}
