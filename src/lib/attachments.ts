import type { PresetAttachment } from "@/db/schema";

/**
 * Reads an uploaded email-preset attachment (pricing sheet, portfolio
 * sample) into a PresetAttachment — the bytes are stored inline (base64)
 * on the preset row itself rather than in external storage, so every send
 * reuses this exact same stored copy with no extra network fetch. See the
 * schema comment on messagePresets.attachments for why this replaced a
 * Vercel Blob URL.
 */
export async function encodeAttachment(file: File): Promise<PresetAttachment> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return { id: crypto.randomUUID(), filename: file.name, content: buffer.toString("base64") };
}
