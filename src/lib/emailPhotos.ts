import { eq } from "drizzle-orm";
import { db } from "@/db";
import { messagePresetVariants, type PresetAttachment, type VariantInlinePhotos } from "@/db/schema";
import { contentTypeFor } from "@/lib/attachments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What mail apps show in a message body. HEIC isn't one of them. */
const SHOWN_INLINE = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** A photo a mail app can show in the body. Takes metadata or the full attachment. */
export function isInlinePhoto(a: { filename: string; contentType?: string | null }): boolean {
  return SHOWN_INLINE.includes(a.contentType || contentTypeFor(a.filename));
}

/**
 * Splits a template's attachments the way one of its variants wants them
 * (messagePresetVariants.inlinePhotos): which go as files, and which photos go
 * in the body.
 */
export function splitEmailFiles<T extends { filename: string; contentType?: string | null }>(
  attachments: T[],
  config: VariantInlinePhotos | null | undefined
): { attachments: T[]; inlinePhotos: T[] } {
  if (!config) return { attachments, inlinePhotos: [] };
  const drop = new Set(config.dropAttachments ?? []);
  return {
    attachments: attachments.filter((a) => !isInlinePhoto(a) && !drop.has(a.filename)),
    inlinePhotos: config.place === "inline" ? attachments.filter(isInlinePhoto) : [],
  };
}

/**
 * The files for an email sent from this variant: its template's attachments,
 * with the photos moved into the body for a variant set up that way.
 *
 * Every other variant gets its attachments back untouched and stays plain
 * text. That is deliberate: Lukas's emails read as one person writing to
 * another, and the samples email is the only one where the pictures are the
 * point (2026-10-12).
 */
export async function emailFilesFor(
  variantId: string | null | undefined,
  attachments: PresetAttachment[] | null | undefined
): Promise<{ attachments: PresetAttachment[]; inlinePhotos: PresetAttachment[] }> {
  const files = attachments ?? [];
  if (!variantId || !UUID.test(variantId)) return { attachments: files, inlinePhotos: [] };
  const [variant] = await db
    .select({ inlinePhotos: messagePresetVariants.inlinePhotos })
    .from(messagePresetVariants)
    .where(eq(messagePresetVariants.id, variantId));
  return splitEmailFiles(files, variant?.inlinePhotos);
}
