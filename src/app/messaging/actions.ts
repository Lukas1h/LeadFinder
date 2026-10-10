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
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attachmentMetaSql, encodeAttachment, withContentTypes, type AttachmentMeta } from "@/lib/attachments";

export interface PresetCriteriaInput {
  minScore: number | null;
  maxScore: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  maxListingAgeDays: number | null;
  minPhotoCount: number | null;
  maxPhotoCount: number | null;
  leadSection: string | null;
  comingSoon: boolean | null;
  sitting: boolean | null;
}

/** SMS only — what happens after a text from this preset (see the schema columns). */
export interface PresetFollowUpInput {
  secondMessage: string | null;
  /** The buttons on a message sent from this preset, in order (see the schema). */
  quickActionPresetIds: string[];
  /** Omitted = leave as is (see messagePresets.quickActionOnly). */
  quickActionOnly?: boolean;
  /** Omitted = leave as is (see messagePresets.pitchesListing). */
  pitchesListing?: boolean;
}

function followUpColumns(input: PresetFollowUpInput) {
  return {
    secondMessage: input.secondMessage?.trim() || null,
    quickActionPresetIds: [...new Set(input.quickActionPresetIds)],
    ...(input.quickActionOnly != null ? { quickActionOnly: input.quickActionOnly } : {}),
    ...(input.pitchesListing != null ? { pitchesListing: input.pitchesListing } : {}),
  };
}

export async function createPreset(
  input: { name: string; type: PresetType; channel: MessageChannel } & PresetCriteriaInput & PresetFollowUpInput
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
    leadSection: input.leadSection,
    minPhotoCount: input.minPhotoCount,
    maxPhotoCount: input.maxPhotoCount,
    comingSoon: input.comingSoon,
    sitting: input.sitting,
    ...followUpColumns(input),
  });
  revalidatePath("/messaging");
  return { error: null };
}

export async function updatePreset(id: string, input: { name: string } & PresetCriteriaInput & PresetFollowUpInput) {
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
      leadSection: input.leadSection,
      minPhotoCount: input.minPhotoCount,
      maxPhotoCount: input.maxPhotoCount,
      comingSoon: input.comingSoon,
      sitting: input.sitting,
      ...followUpColumns(input),
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
  const [preset] = await db
    .select({ protected: messagePresets.protected })
    .from(messagePresets)
    .where(eq(messagePresets.id, id));
  if (preset?.protected) return { error: "This is a built-in preset and can't be deleted." };

  const [sent] = await db
    .select({ id: messageSends.id })
    .from(messageSends)
    .where(eq(messageSends.presetId, id))
    .limit(1);
  if (sent) {
    // Keep its sends (they're the contact history for those agents) and
    // just hide it — see messagePresets.archivedAt.
    await db.update(messagePresets).set({ archivedAt: new Date(), enabled: false }).where(eq(messagePresets.id, id));
    revalidatePath("/messaging");
    return { error: null, archived: true };
  }

  await db.delete(messagePresets).where(eq(messagePresets.id, id));
  revalidatePath("/messaging");
  return { error: null, archived: false };
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

/** Uploads a file (pricing sheet, portfolio sample, vCard) and attaches it to every message sent from this preset. */
export async function uploadPresetAttachment(presetId: string, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file" };
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: "File is too large (max 8MB)" };
  return addPresetAttachment(presetId, await encodeAttachment(file));
}

/** Adds an already-encoded file to a preset: the upload above, and the phone's (api/app/v1/presets). */
export async function addPresetAttachment(presetId: string, encoded: PresetAttachment) {
  const [preset] = await db
    .select({ attachments: messagePresets.attachments })
    .from(messagePresets)
    .where(eq(messagePresets.id, presetId));
  if (!preset) return { error: "Preset not found" };

  await db
    .update(messagePresets)
    .set({ attachments: [...preset.attachments, encoded] })
    .where(eq(messagePresets.id, presetId));

  revalidatePath("/messaging");
  return { error: null };
}

export async function removePresetAttachment(presetId: string, attachmentId: string) {
  const [preset] = await db
    .select({ attachments: messagePresets.attachments })
    .from(messagePresets)
    .where(eq(messagePresets.id, presetId));
  if (!preset) return { error: "Preset not found" };

  await db
    .update(messagePresets)
    .set({ attachments: preset.attachments.filter((a: PresetAttachment) => a.id !== attachmentId) })
    .where(eq(messagePresets.id, presetId));

  revalidatePath("/messaging");
  return { error: null };
}

/** A template as the editors list it: everything but the attachment bytes. */
export interface PresetSummary {
  id: string;
  name: string;
  type: PresetType;
  channel: MessageChannel;
  enabled: boolean;
  aiGenerated: boolean;
  protected: boolean;
  secondMessage: string | null;
  quickActionPresetIds: string[];
  quickActionOnly: boolean;
  attachments: AttachmentMeta[];
  variants: { id: string; label: string; subject: string | null; body: string; enabled: boolean }[];
}

/** Every template that isn't archived, oldest first, with its variants. */
export async function listPresets(): Promise<PresetSummary[]> {
  const [presets, variants] = await Promise.all([
    db
      .select({
        id: messagePresets.id,
        name: messagePresets.name,
        type: messagePresets.type,
        channel: messagePresets.channel,
        enabled: messagePresets.enabled,
        aiGenerated: messagePresets.aiGenerated,
        protected: messagePresets.protected,
        secondMessage: messagePresets.secondMessage,
        quickActionPresetIds: messagePresets.quickActionPresetIds,
        quickActionOnly: messagePresets.quickActionOnly,
        attachments: attachmentMetaSql,
      })
      .from(messagePresets)
      .where(isNull(messagePresets.archivedAt))
      .orderBy(messagePresets.createdAt),
    db
      .select({
        id: messagePresetVariants.id,
        presetId: messagePresetVariants.presetId,
        label: messagePresetVariants.label,
        subject: messagePresetVariants.subject,
        body: messagePresetVariants.body,
        enabled: messagePresetVariants.enabled,
      })
      .from(messagePresetVariants)
      .orderBy(messagePresetVariants.createdAt),
  ]);
  return presets.map((p) => ({
    ...p,
    attachments: withContentTypes(p.attachments),
    // An AI draft's "variants" are the one-off drafts it has sent, not something to edit.
    variants: p.aiGenerated ? [] : variants.filter((v) => v.presetId === p.id).map(({ presetId: _, ...v }) => v),
  }));
}

/**
 * The phone's template editor: changes only the fields it sends. The
 * recommendation criteria stay on the web, where there's room for them.
 */
export async function patchPreset(
  id: string,
  input: { name?: string; enabled?: boolean; secondMessage?: string | null; quickActionPresetIds?: string[] }
): Promise<{ error: string | null }> {
  const set: Partial<typeof messagePresets.$inferInsert> = {};
  if (input.name != null) {
    const name = input.name.trim();
    if (!name) return { error: "Name is required" };
    set.name = name;
  }
  if (input.enabled != null) set.enabled = input.enabled;
  if (input.secondMessage !== undefined) set.secondMessage = input.secondMessage?.trim() || null;
  if (input.quickActionPresetIds) {
    const ids = [...new Set(input.quickActionPresetIds)];
    if (ids.includes(id)) return { error: "A template can't be its own quick action" };
    if (ids.length > 0) {
      const found = await db
        .select({ id: messagePresets.id })
        .from(messagePresets)
        .where(and(inArray(messagePresets.id, ids), isNull(messagePresets.archivedAt)));
      if (found.length !== ids.length) return { error: "One of those quick actions isn't a template" };
    }
    set.quickActionPresetIds = ids;
  }
  if (Object.keys(set).length === 0) return { error: null };

  const updated = await db.update(messagePresets).set(set).where(eq(messagePresets.id, id)).returning({ id: messagePresets.id });
  if (updated.length === 0) return { error: "Preset not found" };
  revalidatePath("/messaging");
  return { error: null };
}
