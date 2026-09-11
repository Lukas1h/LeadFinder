import { put, del } from "@vercel/blob";
import type { PresetAttachment } from "@/db/schema";

/** Uploads one email-preset attachment (pricing sheet, portfolio sample) to Vercel Blob. */
export async function uploadAttachment(file: File): Promise<PresetAttachment> {
  const blob = await put(`attachments/${crypto.randomUUID()}-${file.name}`, file, {
    access: "public",
    addRandomSuffix: false,
  });
  return { filename: file.name, url: blob.url };
}

export async function deleteAttachment(url: string): Promise<void> {
  await del(url);
}
