"use server";

import { db } from "@/db";
import {
  listings,
  messagePresets,
  messagePresetVariants,
  messageSends,
  type PresetType,
} from "@/db/schema";
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { renderMessageBody, DEFAULT_INITIAL_BODY, DEFAULT_FOLLOWUP_BODY } from "@/lib/messageTemplate";
import { touchAgentContact } from "@/app/actions";

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

  const [listing] = await db
    .select({
      agentName: listings.agentName,
      address: listings.address,
      score: listings.score,
      price: listings.price,
      photoCount: listings.photoCount,
      listedAt: listings.listedAt,
      foundAt: listings.foundAt,
    })
    .from(listings)
    .where(eq(listings.id, listingId));
  if (!listing) return { presets: [] };

  const ageDays = listingAgeDays(listing.listedAt, listing.foundAt);

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
        eq(messagePresetVariants.enabled, true)
      )
    )
    .orderBy(messagePresets.createdAt);

  if (rows.length === 0) return { presets: [] };

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

  return { presets };
}

/**
 * Logs a send against the chosen preset variant, then applies the same
 * listing mutation the old hardcoded flow did: initial outreach moves the
 * lead to "contacted"; a follow-up just resets the follow-up clock.
 */
export async function sendMessage(
  listingId: string,
  type: PresetType,
  presetId: string,
  variantId: string
) {
  const now = new Date();

  await db.insert(messageSends).values({ listingId, presetId, variantId, type, sentAt: now });

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
