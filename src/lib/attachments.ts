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

/**
 * Fetches each attachment's bytes once — for bulk sends, where the same
 * preset attachment(s) get sent to many recipients in one call.
 * sendEmail's href-based attachments make nodemailer do its own Blob fetch
 * per recipient, so without this a 40-contact batch multiplies the same
 * file's Blob data-transfer by 40x. This is what filled up the Blob
 * store's transfer quota (usageQuotaExceeded) despite the store itself
 * holding only a couple small files.
 */
export async function resolveAttachments(
  attachments: PresetAttachment[]
): Promise<{ filename: string; content: Buffer }[]> {
  return Promise.all(
    attachments.map(async (a) => {
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(`Failed to fetch attachment ${a.filename}: HTTP ${res.status}`);
      return { filename: a.filename, content: Buffer.from(await res.arrayBuffer()) };
    })
  );
}
