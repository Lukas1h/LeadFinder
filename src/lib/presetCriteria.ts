// Which template the Send dialog recommends for a listing — shared by the
// text options (getMessageOptions) and the email options
// (getComposeEmailOptions) so both channels pick the same way.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, type Listing } from "@/db/schema";
import { leadSectionForListing } from "@/lib/leadSections";
import { isWarmAgentStatus } from "@/lib/pipeline";

export interface PresetCriteria {
  minScore: number | null;
  leadSection: string | null;
  maxScore: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  maxListingAgeDays: number | null;
  minPhotoCount: number | null;
  maxPhotoCount: number | null;
  comingSoon: boolean | null;
  sitting: boolean | null;
}

/** See messagePresets.sitting. */
export const SITTING_DAYS = 30;

export function isSitting(ageDays: number, priceCutAt: Date | null): boolean {
  if (ageDays >= SITTING_DAYS) return true;
  return priceCutAt != null && Date.now() - priceCutAt.getTime() <= SITTING_DAYS * 24 * 60 * 60 * 1000;
}

export function listingAgeDays(listedAt: Date | null, foundAt: Date): number {
  const reference = listedAt ?? foundAt;
  return Math.floor((Date.now() - reference.getTime()) / (24 * 60 * 60 * 1000));
}

/** A preset with no criteria set always matches — only set constraints can disqualify it. */
export function matchesCriteria(
  preset: PresetCriteria,
  listing: {
    score: number | null;
    price: number | null;
    ageDays: number;
    photoCount: number | null;
    leadSection: string | null;
    isComingSoon: boolean;
    sitting: boolean;
  }
): boolean {
  // Section is the one criterion that isn't a measurement of the property, so
  // a preset can be pointed at the Leads-page section rather than at a score
  // band. Null on the preset means no constraint, like every other field.
  if (preset.leadSection != null && preset.leadSection !== listing.leadSection) return false;
  if (preset.comingSoon != null && preset.comingSoon !== listing.isComingSoon) return false;
  if (preset.sitting != null && preset.sitting !== listing.sitting) return false;
  if (preset.minScore != null && (listing.score == null || listing.score < preset.minScore)) return false;
  // A missing score must not disqualify on an upper bound: "we don't know yet"
  // isn't "too high". Treating null as a miss meant a preset capped at 6 (the
  // photo-opportunity one) could never be recommended for a listing whose photos
  // hadn't been scored, so exactly the leads with the least evidence about them
  // were the only ones excluded from it. Lower bounds are deliberately
  // unchanged — an unscored listing genuinely cannot satisfy "at least this
  // good", so minScore still rejects null.
  if (preset.maxScore != null && listing.score != null && listing.score > preset.maxScore) return false;
  if (preset.minPrice != null && (listing.price == null || listing.price < preset.minPrice)) return false;
  if (preset.maxPrice != null && (listing.price == null || listing.price > preset.maxPrice)) return false;
  if (preset.maxListingAgeDays != null && listing.ageDays > preset.maxListingAgeDays) return false;
  if (
    preset.minPhotoCount != null &&
    (listing.photoCount == null || listing.photoCount < preset.minPhotoCount)
  )
    return false;
  if (
    preset.maxPhotoCount != null &&
    (listing.photoCount == null || listing.photoCount > preset.maxPhotoCount)
  )
    return false;
  return true;
}

export function criteriaCount(preset: PresetCriteria): number {
  return [
    preset.minScore,
    preset.maxScore,
    preset.minPrice,
    preset.maxPrice,
    preset.maxListingAgeDays,
    preset.minPhotoCount,
    preset.maxPhotoCount,
    preset.leadSection,
    preset.comingSoon,
    preset.sitting,
  ].filter((v) => v != null).length;
}

export type ListingMatchFacts = Parameters<typeof matchesCriteria>[1];

/** The listing facts every criterion is checked against. */
export function listingMatchFacts(listing: Listing): ListingMatchFacts {
  const ageDays = listingAgeDays(listing.listedAt, listing.foundAt);
  return {
    score: listing.score,
    price: listing.price,
    ageDays,
    photoCount: listing.photoCount,
    leadSection: listing.leadSection ?? leadSectionForListing(listing),
    isComingSoon: listing.isComingSoon,
    sitting: isSitting(ageDays, listing.priceCutAt),
  };
}

/**
 * The recommended preset's id: the most specific hand-written preset whose
 * criteria the listing meets, unless the AI-draft preset is more specific
 * still. Ties go to the hand-written one.
 *
 * `knownAgent` (warm or better) always gets the AI draft: every hand-written
 * template opens with "I'm Lukas," which reads wrong to someone who already
 * has him in their phone, and the draft skips that intro for them.
 */
export function pickRecommendedPreset(
  presets: (PresetCriteria & { id: string; protected: boolean; sameOffice?: boolean })[],
  aiPreset: (PresetCriteria & { id: string }) | null,
  facts: ListingMatchFacts,
  knownAgent = false,
  sameOffice = false
): string | null {
  // A stranger at a client's office gets the template that names the client —
  // that intro beats any photo or price pitch (Bryan McKeun said yes within
  // minutes, Oct 8).
  const officePreset = presets.find((p) => p.sameOffice && !p.protected);
  if (sameOffice && officePreset) return officePreset.id;
  if (knownAgent && aiPreset) return aiPreset.id;
  let recommendedPresetId: string | null = null;
  let bestCriteriaCount = -1;
  for (const preset of presets) {
    // The Blank preset is never "recommended" — it's the fallback when
    // nothing is, and tagging it "(Recommended)" too would just be a
    // confusing double label on the same option.
    if (preset.protected || preset.sameOffice) continue;
    if (!matchesCriteria(preset, facts)) continue;
    const specificity = criteriaCount(preset);
    if (specificity > bestCriteriaCount) {
      bestCriteriaCount = specificity;
      recommendedPresetId = preset.id;
    }
  }

  // The AI-draft preset runs through the identical contest. It has no reusable
  // variant to rotate, but it is a preset with criteria like any other and
  // should win or lose on the same terms: give it a section and it's the
  // recommendation there, give it nothing and the hand-written presets keep it.
  if (aiPreset) {
    const specificity = criteriaCount(aiPreset);
    // The unlikely section is the one place we knowingly message a lead with no
    // good photo or price story behind them — usually an agent we can't reach,
    // or one who told us to leave them alone. No hand-written preset should
    // catch those: each is gated to the section it was written for, and a
    // preset that ignored the section would happily text a $1m listing whose
    // agent has declined. The AI draft is the right recommendation there, so it
    // wins outright — regardless of the photo section it targets elsewhere.
    if (facts.leadSection === "unlikely") {
      recommendedPresetId = aiPreset.id;
    } else if (specificity > 0 && matchesCriteria(aiPreset, facts) && specificity > bestCriteriaCount) {
      recommendedPresetId = aiPreset.id;
    }
  }
  return recommendedPresetId;
}

/** Whether the listing's agent already knows Lukas (warm or better). */
export async function isKnownAgent(agentId: string | null): Promise<boolean> {
  if (!agentId) return false;
  const [row] = await db
    .select({ status: agents.relationshipStatus })
    .from(agents)
    .where(eq(agents.id, agentId));
  return row ? isWarmAgentStatus(row.status) : false;
}
