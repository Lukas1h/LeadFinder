"use server";

import { db } from "@/db";
import {
  messagePresets,
  messagePresetVariants,
  messageSends,
  type PresetType,
  type MessageChannel,
  type PresetAttachment,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { uploadAttachment, deleteAttachment } from "@/lib/attachments";

export interface PresetCriteriaInput {
  minScore: number | null;
  maxScore: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  maxListingAgeDays: number | null;
  minPhotoCount: number | null;
  maxPhotoCount: number | null;
}

export async function createPreset(
  input: { name: string; type: PresetType; channel: MessageChannel } & PresetCriteriaInput
) {
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };

  await db.insert(messagePresets).values({
    name,
    type: input.type,
    channel: input.channel,
    minScore: input.minScore,
    maxScore: input.maxScore,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    maxListingAgeDays: input.maxListingAgeDays,
    minPhotoCount: input.minPhotoCount,
    maxPhotoCount: input.maxPhotoCount,
  });
  revalidatePath("/messaging");
  return { error: null };
}

export async function updatePreset(id: string, input: { name: string } & PresetCriteriaInput) {
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };

  await db
    .update(messagePresets)
    .set({
      name,
      minScore: input.minScore,
      maxScore: input.maxScore,
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      maxListingAgeDays: input.maxListingAgeDays,
      minPhotoCount: input.minPhotoCount,
      maxPhotoCount: input.maxPhotoCount,
    })
    .where(eq(messagePresets.id, id));
  revalidatePath("/messaging");
  return { error: null };
}

export async function togglePreset(id: string, enabled: boolean) {
  await db.update(messagePresets).set({ enabled }).where(eq(messagePresets.id, id));
  revalidatePath("/messaging");
}

export async function deletePreset(id: string) {
  const [sent] = await db
    .select({ id: messageSends.id })
    .from(messageSends)
    .where(eq(messageSends.presetId, id))
    .limit(1);
  if (sent) return { error: "This preset has send history — disable it instead of deleting." };

  await db.delete(messagePresets).where(eq(messagePresets.id, id));
  revalidatePath("/messaging");
  return { error: null };
}

export async function createVariant(
  presetId: string,
  input: { label: string; body: string; subject?: string }
) {
  const label = input.label.trim();
  const body = input.body.trim();
  const subject = input.subject?.trim() || null;
  if (!label) return { error: "Label is required" };
  if (!body) return { error: "Message body is required" };

  const [preset] = await db
    .select({ channel: messagePresets.channel })
    .from(messagePresets)
    .where(eq(messagePresets.id, presetId));
  if (preset?.channel === "email" && !subject) return { error: "Subject is required for email" };

  await db.insert(messagePresetVariants).values({ presetId, label, body, subject });
  revalidatePath("/messaging");
  return { error: null };
}

export async function updateVariant(id: string, input: { label: string; body: string; subject?: string }) {
  const label = input.label.trim();
  const body = input.body.trim();
  const subject = input.subject?.trim() || null;
  if (!label) return { error: "Label is required" };
  if (!body) return { error: "Message body is required" };

  const [variant] = await db
    .select({ presetId: messagePresetVariants.presetId })
    .from(messagePresetVariants)
    .where(eq(messagePresetVariants.id, id));
  if (variant) {
    const [preset] = await db
      .select({ channel: messagePresets.channel })
      .from(messagePresets)
      .where(eq(messagePresets.id, variant.presetId));
    if (preset?.channel === "email" && !subject) return { error: "Subject is required for email" };
  }

  await db
    .update(messagePresetVariants)
    .set({ label, body, subject })
    .where(eq(messagePresetVariants.id, id));
  revalidatePath("/messaging");
  return { error: null };
}

export async function toggleVariant(id: string, enabled: boolean) {
  await db.update(messagePresetVariants).set({ enabled }).where(eq(messagePresetVariants.id, id));
  revalidatePath("/messaging");
}

export async function deleteVariant(id: string) {
  const [sent] = await db
    .select({ id: messageSends.id })
    .from(messageSends)
    .where(eq(messageSends.variantId, id))
    .limit(1);
  if (sent) return { error: "This variant has send history — disable it instead of deleting." };

  await db.delete(messagePresetVariants).where(eq(messagePresetVariants.id, id));
  revalidatePath("/messaging");
  return { error: null };
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Uploads a file (pricing sheet, portfolio sample) and attaches it to every email sent from this preset. */
export async function uploadPresetAttachment(presetId: string, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file" };
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: "File is too large (max 8MB)" };

  const [preset] = await db
    .select({ attachments: messagePresets.attachments })
    .from(messagePresets)
    .where(eq(messagePresets.id, presetId));
  if (!preset) return { error: "Preset not found" };

  const uploaded = await uploadAttachment(file);
  await db
    .update(messagePresets)
    .set({ attachments: [...preset.attachments, uploaded] })
    .where(eq(messagePresets.id, presetId));

  revalidatePath("/messaging");
  return { error: null };
}

export async function removePresetAttachment(presetId: string, url: string) {
  const [preset] = await db
    .select({ attachments: messagePresets.attachments })
    .from(messagePresets)
    .where(eq(messagePresets.id, presetId));
  if (!preset) return { error: "Preset not found" };

  await db
    .update(messagePresets)
    .set({ attachments: preset.attachments.filter((a: PresetAttachment) => a.url !== url) })
    .where(eq(messagePresets.id, presetId));
  await deleteAttachment(url).catch(() => {}); // best-effort — a stray blob is harmless, a stuck UI isn't

  revalidatePath("/messaging");
  return { error: null };
}
