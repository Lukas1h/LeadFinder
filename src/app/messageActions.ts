"use server";

import { db } from "@/db";
import {
  listings,
  agents,
  messagePresets,
  messagePresetVariants,
  messageSends,
  type PresetType,
  type AgentRelationshipStatus,
} from "@/db/schema";
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  renderMessageBody,
  DEFAULT_INITIAL_BODY,
  DEFAULT_FOLLOWUP_BODY,
  AI_DRAFT_VARIANT_SENTINEL,
} from "@/lib/messageTemplate";
import { draftMessage } from "@/lib/draftMessage";
import { touchAgentContact } from "@/app/actions";

const AI_DRAFT_PRESET_NAME = "AI Draft";

/**
 * Idempotent — inserts the two starter presets ("Initial Outreach",
 * "Follow-up", each with one variant carrying the app's original hardcoded
 * copy) the first time this is called with an empty message_presets table.
 * Called from getMessageOptions and the /presets page so the send flow
 * always has at least one usable preset per type.
 */
export async function ensureDefaultPresets() {
  const [existing] = await db.select({ id: messagePresets.id }).from(messagePresets).limit(1);
  if (existing) return;

  const [initial] = await db
    .insert(messagePresets)
    .values({ name: "Initial Outreach", type: "initial_outreach" })
    .returning({ id: messagePresets.id });
  await db.insert(messagePresetVariants).values({
    presetId: initial.id,
    label: "A",
    body: DEFAULT_INITIAL_BODY,
  });

  const [followUp] = await db
    .insert(messagePresets)
    .values({ name: "Follow-up", type: "follow_up" })
    .returning({ id: messagePresets.id });
  await db.insert(messagePresetVariants).values({
    presetId: followUp.id,
    label: "A",
    body: DEFAULT_FOLLOWUP_BODY,
  });
}

/**
 * Idempotent — inserts the "AI Draft" system preset for each type the
 * first time it's needed. Unlike ensureDefaultPresets, these start with
 * zero variants: a variant only gets created (see sendMessage) at the
 * moment an AI draft is actually sent, since each one is a one-off drafted
 * for that specific listing rather than reusable template text.
 */
export async function ensureAiDraftPresets(type: PresetType) {
  const [existing] = await db
    .select({ id: messagePresets.id })
    .from(messagePresets)
    .where(and(eq(messagePresets.type, type), eq(messagePresets.aiGenerated, true)));
  if (existing) return;

  await db.insert(messagePresets).values({ name: AI_DRAFT_PRESET_NAME, type, aiGenerated: true });
}

export interface PresetOption {
  presetId: string;
  presetName: string;
  variantId: string;
  variantLabel: string;
  text: string;
  recommended: boolean;
}

export interface MessageOptions {
  presets: PresetOption[];
}

interface PresetCriteria {
  minScore: number | null;
  maxScore: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  maxListingAgeDays: number | null;
  minPhotoCount: number | null;
  maxPhotoCount: number | null;
}

function listingAgeDays(listedAt: Date | null, foundAt: Date): number {
  const reference = listedAt ?? foundAt;
  return Math.floor((Date.now() - reference.getTime()) / (24 * 60 * 60 * 1000));
}

/** A preset with no criteria set always matches — only set constraints can disqualify it. */
function matchesCriteria(
  preset: PresetCriteria,
  listing: { score: number | null; price: number | null; ageDays: number; photoCount: number | null }
): boolean {
  if (preset.minScore != null && (listing.score == null || listing.score < preset.minScore)) return false;
  if (preset.maxScore != null && (listing.score == null || listing.score > preset.maxScore)) return false;
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

function criteriaCount(preset: PresetCriteria): number {
  return [
    preset.minScore,
    preset.maxScore,
    preset.minPrice,
    preset.maxPrice,
    preset.maxListingAgeDays,
    preset.minPhotoCount,
    preset.maxPhotoCount,
  ].filter((v) => v != null).length;
}

/**
 * Loads every enabled preset for `type`, each paired with whichever of its
 * enabled variants is next in rotation (fewest sends so far, tie broken by
 * label so the rotation is a deterministic A/B/A/B… sequence rather than a
 * random pick) — the sender only chooses a preset, never a variant, so
 * split-test stats stay honest. Exactly one preset (the most specific one
 * whose photo-score/price/listing-age criteria the listing satisfies) is
 * flagged `recommended` for the dialog to default to.
 */
export async function getMessageOptions(listingId: string, type: PresetType): Promise<MessageOptions> {
  await ensureDefaultPresets();
  await ensureAiDraftPresets(type);

  const [listing] = await db
    .select({
      agentName: listings.agentName,
      agentPhone: listings.agentPhone,
      address: listings.address,
      city: listings.city,
      state: listings.state,
      price: listings.price,
      bedrooms: listings.bedrooms,
      bathrooms: listings.bathrooms,
      livingArea: listings.livingArea,
      homeType: listings.homeType,
      isComingSoon: listings.isComingSoon,
      score: listings.score,
      scoreReasoning: listings.scoreReasoning,
      photoCount: listings.photoCount,
      photos: listings.photos,
      listedAt: listings.listedAt,
      foundAt: listings.foundAt,
    })
    .from(listings)
    .where(eq(listings.id, listingId));
  if (!listing) return { presets: [] };

  const ageDays = listingAgeDays(listing.listedAt, listing.foundAt);

  // aiGenerated presets are excluded here — they have no reusable variants
  // to rotate through (see ensureAiDraftPresets); the AI option is drafted
  // fresh below instead.
  const rows = await db
    .select({
      presetId: messagePresets.id,
      presetName: messagePresets.name,
      minScore: messagePresets.minScore,
      maxScore: messagePresets.maxScore,
      minPrice: messagePresets.minPrice,
      maxPrice: messagePresets.maxPrice,
      maxListingAgeDays: messagePresets.maxListingAgeDays,
      minPhotoCount: messagePresets.minPhotoCount,
      maxPhotoCount: messagePresets.maxPhotoCount,
      variantId: messagePresetVariants.id,
      label: messagePresetVariants.label,
      body: messagePresetVariants.body,
    })
    .from(messagePresetVariants)
    .innerJoin(messagePresets, eq(messagePresetVariants.presetId, messagePresets.id))
    .where(
      and(
        eq(messagePresets.type, type),
        eq(messagePresets.enabled, true),
        eq(messagePresets.aiGenerated, false),
        eq(messagePresetVariants.enabled, true)
      )
    )
    .orderBy(messagePresets.createdAt);

  const sendCounts = await db
    .select({ variantId: messageSends.variantId, count: count() })
    .from(messageSends)
    .groupBy(messageSends.variantId);
  const countByVariant = new Map(sendCounts.map((r) => [r.variantId, r.count]));

  const rowsByPreset = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = rowsByPreset.get(row.presetId);
    if (group) group.push(row);
    else rowsByPreset.set(row.presetId, [row]);
  }

  let recommendedPresetId: string | null = null;
  let bestCriteriaCount = -1;
  for (const group of rowsByPreset.values()) {
    const preset = group[0];
    if (
      !matchesCriteria(preset, {
        score: listing.score,
        price: listing.price,
        ageDays,
        photoCount: listing.photoCount,
      })
    )
      continue;
    const specificity = criteriaCount(preset);
    if (specificity > bestCriteriaCount) {
      bestCriteriaCount = specificity;
      recommendedPresetId = preset.presetId;
    }
  }

  const presets: PresetOption[] = Array.from(rowsByPreset.values()).map((group) => {
    const minCount = Math.min(...group.map((r) => countByVariant.get(r.variantId) ?? 0));
    const leastUsed = group
      .filter((r) => (countByVariant.get(r.variantId) ?? 0) === minCount)
      .sort((a, b) => a.label.localeCompare(b.label));
    const picked = leastUsed[0];

    return {
      presetId: picked.presetId,
      presetName: picked.presetName,
      variantId: picked.variantId,
      variantLabel: picked.label,
      text: renderMessageBody(picked.body, listing.agentName, listing.address),
      recommended: picked.presetId === recommendedPresetId,
    };
  });

  const aiOption = await buildAiDraftOption(listingId, type, listing, ageDays);
  if (aiOption) {
    for (const p of presets) p.recommended = false;
    presets.unshift(aiOption);
  }

  return { presets };
}

interface ListingForDraft {
  agentName: string | null;
  agentPhone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  bedrooms: string | null;
  bathrooms: string | null;
  livingArea: number | null;
  homeType: string | null;
  isComingSoon: boolean;
  score: number | null;
  scoreReasoning: string | null;
  photoCount: number | null;
  photos: string[] | null;
}

/**
 * Drafts and returns the AI option, or null if there's no enabled AI-draft
 * preset for this type or the draft call fails — either way the dialog
 * just falls back to the regular presets.
 */
async function buildAiDraftOption(
  listingId: string,
  type: PresetType,
  listing: ListingForDraft,
  ageDays: number
): Promise<PresetOption | null> {
  const [preset] = await db
    .select({ id: messagePresets.id, name: messagePresets.name })
    .from(messagePresets)
    .where(and(eq(messagePresets.type, type), eq(messagePresets.aiGenerated, true), eq(messagePresets.enabled, true)));
  if (!preset) return null;

  let agent: { relationshipStatus: AgentRelationshipStatus; lastContactedAt: Date | null } | null = null;
  let agentListingCount = 0;
  if (listing.agentPhone) {
    const [agentRow] = await db
      .select({ relationshipStatus: agents.relationshipStatus, lastContactedAt: agents.lastContactedAt })
      .from(agents)
      .where(eq(agents.phone, listing.agentPhone));
    agent = agentRow ?? null;

    const [{ count: listingCount }] = await db
      .select({ count: count() })
      .from(listings)
      .where(eq(listings.agentPhone, listing.agentPhone));
    agentListingCount = listingCount;
  }

  const text = await draftMessage({
    type,
    address: listing.address,
    city: listing.city,
    state: listing.state,
    price: listing.price,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    livingArea: listing.livingArea,
    homeType: listing.homeType,
    isComingSoon: listing.isComingSoon,
    photoCount: listing.photoCount,
    photos: listing.photos,
    score: listing.score,
    scoreReasoning: listing.scoreReasoning,
    ageDays,
    agentName: listing.agentName,
    agentRelationshipStatus: agent?.relationshipStatus ?? null,
    agentListingCount,
    agentLastContactedAt: agent?.lastContactedAt ?? null,
  });
  if (!text) return null;

  return {
    presetId: preset.id,
    presetName: preset.name,
    variantId: AI_DRAFT_VARIANT_SENTINEL,
    variantLabel: "AI",
    text,
    recommended: true,
  };
}

/**
 * Logs a send against the chosen preset variant, then applies the same
 * listing mutation the old hardcoded flow did: initial outreach moves the
 * lead to "contacted"; a follow-up just resets the follow-up clock.
 *
 * `finalText` is the exact text actually sent (after any edits made in the
 * dialog). It's only used when `variantId` is the AI-draft sentinel — that
 * variant doesn't exist yet, since each AI draft is one-off, so it's
 * materialized as a real messagePresetVariants row here, at the moment of
 * sending, rather than speculatively for every dialog open.
 */
export async function sendMessage(
  listingId: string,
  type: PresetType,
  presetId: string,
  variantId: string,
  finalText: string
) {
  const now = new Date();

  let resolvedVariantId = variantId;
  if (variantId === AI_DRAFT_VARIANT_SENTINEL) {
    const [variant] = await db
      .insert(messagePresetVariants)
      .values({ presetId, label: `AI · ${now.toLocaleDateString()}`, body: finalText })
      .returning({ id: messagePresetVariants.id });
    resolvedVariantId = variant.id;
  }

  await db.insert(messageSends).values({ listingId, presetId, variantId: resolvedVariantId, type, sentAt: now });

  const [lead] = await db
    .update(listings)
    .set({
      contactedAt: now,
      statusChangedAt: now,
      ...(type === "initial_outreach" ? { status: "contacted" as const } : {}),
    })
    .where(eq(listings.id, listingId))
    .returning({ agentPhone: listings.agentPhone, agentName: listings.agentName });

  if (lead) {
    await touchAgentContact(listingId, lead.agentPhone, lead.agentName);
  }

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/presets");
}
