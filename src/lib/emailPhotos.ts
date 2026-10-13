import { eq } from "drizzle-orm";
import { db } from "@/db";
import { messagePresets, messagePresetVariants, type PresetAttachment } from "@/db/schema";
import { contentTypeFor } from "@/lib/attachments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What mail apps show in a message body. HEIC isn't one of them. */
const SHOWN_INLINE = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export interface EmailFiles {
  /** Sent as attachments. */
  attachments: PresetAttachment[];
  /** Shown in the body, in order. Empty for nearly every email. */
  inlinePhotos: PresetAttachment[];
}

/**
 * The files for an email sent from this variant: its template's attachments,
 * and for a variant set up with inline photos (messagePresetVariants.
 * inlinePhotos), those photos, minus the attachments they replace.
 *
 * Every other variant gets its attachments back untouched and stays plain
 * text. That is deliberate: Lukas's emails read as one person writing to
 * another, and the samples email is the only one where the pictures are the
 * point (2026-10-12).
 */
export async function emailFilesFor(
  variantId: string | null | undefined,
  attachments: PresetAttachment[] | null | undefined
): Promise<EmailFiles> {
  const plain: EmailFiles = { attachments: attachments ?? [], inlinePhotos: [] };
  if (!variantId || !UUID.test(variantId)) return plain;

  const [variant] = await db
    .select({ inlinePhotos: messagePresetVariants.inlinePhotos })
    .from(messagePresetVariants)
    .where(eq(messagePresetVariants.id, variantId));
  const config = variant?.inlinePhotos;
  if (!config) return plain;

  const [source] = await db
    .select({ attachments: messagePresets.attachments })
    .from(messagePresets)
    .where(eq(messagePresets.id, config.fromPresetId));
  const photos = (source?.attachments ?? [])
    .filter((a) => SHOWN_INLINE.includes(a.contentType || contentTypeFor(a.filename)))
    .slice(0, config.count);
  // The photos are gone from that template: send it as it always was.
  if (photos.length === 0) return plain;

  const drop = new Set(config.dropAttachments ?? []);
  return { attachments: plain.attachments.filter((a) => !drop.has(a.filename)), inlinePhotos: photos };
}
