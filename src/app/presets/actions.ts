"use server";

import { db } from "@/db";
import { messagePresets, messagePresetVariants, messageSends, type PresetType } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export interface PresetCriteriaInput {
  minScore: number | null;
  maxScore: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  maxListingAgeDays: number | null;
  minPhotoCount: number | null;
  maxPhotoCount: number | null;
}

export async function createPreset(input: { name: string; type: PresetType } & PresetCriteriaInput) {
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };

  await db.insert(messagePresets).values({
    name,
    type: input.type,
    minScore: input.minScore,
    maxScore: input.maxScore,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    maxListingAgeDays: input.maxListingAgeDays,
    minPhotoCount: input.minPhotoCount,
    maxPhotoCount: input.maxPhotoCount,
  });
  revalidatePath("/presets");
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
  revalidatePath("/presets");
  return { error: null };
}

export async function togglePreset(id: string, enabled: boolean) {
  await db.update(messagePresets).set({ enabled }).where(eq(messagePresets.id, id));
  revalidatePath("/presets");
}

export async function deletePreset(id: string) {
  const [sent] = await db
    .select({ id: messageSends.id })
    .from(messageSends)
    .where(eq(messageSends.presetId, id))
    .limit(1);
  if (sent) return { error: "This preset has send history — disable it instead of deleting." };

  await db.delete(messagePresets).where(eq(messagePresets.id, id));
  revalidatePath("/presets");
  return { error: null };
}

export async function createVariant(presetId: string, input: { label: string; body: string }) {
  const label = input.label.trim();
  const body = input.body.trim();
  if (!label) return { error: "Label is required" };
  if (!body) return { error: "Message body is required" };

  await db.insert(messagePresetVariants).values({ presetId, label, body });
  revalidatePath("/presets");
  return { error: null };
}

export async function updateVariant(id: string, input: { label: string; body: string }) {
  const label = input.label.trim();
  const body = input.body.trim();
  if (!label) return { error: "Label is required" };
  if (!body) return { error: "Message body is required" };

  await db.update(messagePresetVariants).set({ label, body }).where(eq(messagePresetVariants.id, id));
  revalidatePath("/presets");
  return { error: null };
}

export async function toggleVariant(id: string, enabled: boolean) {
  await db.update(messagePresetVariants).set({ enabled }).where(eq(messagePresetVariants.id, id));
  revalidatePath("/presets");
}

export async function deleteVariant(id: string) {
  const [sent] = await db
    .select({ id: messageSends.id })
    .from(messageSends)
    .where(eq(messageSends.variantId, id))
    .limit(1);
  if (sent) return { error: "This variant has send history — disable it instead of deleting." };

  await db.delete(messagePresetVariants).where(eq(messagePresetVariants.id, id));
  revalidatePath("/presets");
  return { error: null };
}
