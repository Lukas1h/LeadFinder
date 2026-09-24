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

/**
 * Whether this listing's agent is someone you've already been in touch with.
 *
 * Takes the agent findAttachedAgent already resolved rather than re-deriving
 * one from the phone string. It used to do its own phone-only lookup, which
 * meant the badge and the rest of the card could disagree about who the agent
 * even was — the card showed their email and declined state while the badge
 * called them a stranger.
 *
 * Gated on lastContactedAt (contact happened at all), not on
 * lastContactedListingId (which property it was about). Only the two
 * listing-scoped paths — touchAgentContact and touchAgentEmailContact — ever
 * set that pointer, so every cold email left it null and suppressed the badge
 * for the exact people most worth warning about: 18 of the 20 contacted agents
 * on live leads, all of them with a real send on file.
 *
 * The pointer still decides one thing: contacting someone about *this* listing
 * isn't a duplicate, so that case stays unbadged.
 */
export function findDuplicateAgentContact(agent: Agent | null, currentListingId: string): Agent | null {
  if (!agent?.lastContactedAt) return null;
  if (agent.lastContactedListingId === currentListingId) return null;
  return agent;
}

// Criteria for listings unlikely to be a good fit (grouped at the bottom of the leads page):
// 1. High photo score (> 7, pro photography) on lower-priced homes (< $650,000) that likely don't need video.
// 2. The attached agent was marked as declined.
export const UNLIKELY_MATCH_MIN_PHOTO_SCORE = 7;
export const UNLIKELY_MATCH_MAX_PRICE = 650_000;

export function isPhotoPriceUnlikelyMatch(lead: Pick<Listing, "score" | "price">): boolean {
  return (
    lead.score != null &&
    lead.score > UNLIKELY_MATCH_MIN_PHOTO_SCORE &&
    lead.price != null &&
    lead.price < UNLIKELY_MATCH_MAX_PRICE
  );
}

/**
 * Builds the lookups every page needs to answer "who is the agent on this
 * listing, and have I already been talking to them?".
 *
 * byId is the real answer, keyed on listings.agentId. The phone and name maps
 * are fallbacks for rows imported before that column existed, or whose agent
 * couldn't be resolved at import time.
 *
 * Shared because the two pages had drifted: the Leads page keyed phones both
 * raw and digits-only and passed a name map, while Pipeline keyed raw phones
 * only and passed no name map at all — so the same realtor could show as a
 * known contact on one page and a stranger on the other.
 *
 * The name map takes the richest row when a name is ambiguous. It used to be
 * last-writer-wins over an unordered query, so where a person existed twice
 * (email-only from an import, phone-only from a listing) it was a coin flip
 * whether the row with the send history or the empty one won — and losing that
 * flip is what showed a contacted realtor as never-contacted.
 */
export function buildAgentLookups(allAgents: Agent[]): {
  byId: Map<string, Agent>;
  byPhone: Map<string, Agent>;
  byName: Map<string, Agent>;
} {
  const byId = new Map(allAgents.map((a) => [a.id, a]));

  const byPhone = new Map<string, Agent>();
  for (const a of allAgents) {
    if (!a.phone) continue;
    byPhone.set(a.phone, a);
    const digits = a.phone.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
    if (digits) byPhone.set(digits, a);
  }

  const richer = (a: Agent, b: Agent) => {
    if (!!a.lastContactedAt !== !!b.lastContactedAt) return a.lastContactedAt ? a : b;
    if (!!a.email !== !!b.email) return a.email ? a : b;
    return a;
  };

  const byName = new Map<string, Agent>();
  for (const a of allAgents) {
    if (!a.name) continue;
    const key = a.name.trim().toLowerCase();
    const existing = byName.get(key);
    byName.set(key, existing ? richer(existing, a) : a);
  }

  return { byId, byPhone, byName };
}

/**
 * Resolves a listing's agent, preferring the stored FK and falling back to the
 * phone string and then an unambiguous name.
 *
 * The fallbacks are legacy paths, not equals: phone is mutable and optional, so
 * matching on it missed every contact who arrived email-first and silently
 * detached anyone who changed their number. agentId is set at import and on
 * first contact, so it should be the answer for anything recent.
 */
export function findAttachedAgent(
  lead: Pick<Listing, "agentPhone" | "agentName"> & { agentId?: string | null },
  agentByPhone: Map<string, Agent>,
  agentByName?: Map<string, Agent>,
  agentById?: Map<string, Agent>
): Agent | null {
  if (lead.agentId && agentById) {
    const byId = agentById.get(lead.agentId);
    if (byId) return byId;
  }

  if (lead.agentPhone) {
    const raw = agentByPhone.get(lead.agentPhone);
    if (raw) return raw;

    const digits = lead.agentPhone.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
    if (digits) {
      const byDigits = agentByPhone.get(digits);
      if (byDigits) return byDigits;
    }
  }

  if (lead.agentName && agentByName) {
    const byName = agentByName.get(lead.agentName.trim().toLowerCase());
    if (byName) return byName;
  }

  return null;
}

export function isAgentDeclined(
  lead: Pick<Listing, "agentPhone" | "agentName">,
  agentByPhone: Map<string, Agent>,
  agentByName?: Map<string, Agent>
): boolean {
  const agent = findAttachedAgent(lead, agentByPhone, agentByName);
  return agent?.relationshipStatus === "declined";
}

export function isUnlikelyLeadMatch(
  lead: Listing,
  agentByPhone: Map<string, Agent>,
  agentByName?: Map<string, Agent>
): boolean {
  return isPhotoPriceUnlikelyMatch(lead) || isAgentDeclined(lead, agentByPhone, agentByName);
}
