import type { Agent, Listing } from "@/db/schema";

export const FOLLOW_UP_AFTER_DAYS = 3;

// Fewer than this many photos on the listing itself is as strong a signal
// as a bad photo-quality score — the agent likely hasn't hired anyone yet.
export const FEW_PHOTOS_THRESHOLD = 5;

// score <= this is "Poor"/"Amateur" per the PhotoScoreBadge tiers — the
// "needs better photos" bucket in the priority order below.
const NEEDS_BETTER_PHOTOS_MAX_SCORE = 5;

/**
 * Leads page priority order: coming-soon listings first (freshest
 * opportunity, agent may not have hired anyone yet), then very-few-photos
 * listings, then bad-photo-score listings, then everything else. Lower
 * number = higher priority.
 */
export function leadPriorityTier(lead: Listing): number {
  if (lead.isComingSoon) return 0;
  if (lead.photoCount != null && lead.photoCount < FEW_PHOTOS_THRESHOLD) return 1;
  if (lead.score != null && lead.score <= NEEDS_BETTER_PHOTOS_MAX_SCORE) return 2;
  return 3;
}

export function byLeadPriority(a: Listing, b: Listing): number {
  const tierDiff = leadPriorityTier(a) - leadPriorityTier(b);
  if (tierDiff !== 0) return tierDiff;
  // Within a tier, lowest photo score (most needed) first; unscored last.
  if (a.score == null && b.score == null) return 0;
  if (a.score == null) return 1;
  if (b.score == null) return -1;
  return a.score - b.score;
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
