import { sql } from "drizzle-orm";
import { messagePresets, type PresetAttachment } from "@/db/schema";

/** An attachment without its bytes: what a list or a picker needs. */
export interface AttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  /** Bytes, worked out from the base64 length. */
  size: number;
}

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  vcf: "text/vcard",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

export function contentTypeFor(filename: string): string {
  return TYPES[filename.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/**
 * A preset's attachments as metadata only, built in SQL so the bytes never
 * leave the database. They are stored inline on the row (see the schema), and
 * a template with ten photos on it is several megabytes: fine to read when
 * sending, far too much to drag along every time templates are listed.
 */
export const attachmentMetaSql = sql<AttachmentMeta[]>`(
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a->>'id',
    'filename', a->>'filename',
    'contentType', a->>'contentType',
    'size', (length(a->>'content') * 3 / 4)
  ) order by ord), '[]'::jsonb)
  from jsonb_array_elements(${messagePresets.attachments}) with ordinality as t(a, ord)
)`;

/** Fills in the content type for attachments stored before it was recorded. */
export function withContentTypes(attachments: AttachmentMeta[]): AttachmentMeta[] {
  return attachments.map((a) => ({ ...a, contentType: a.contentType || contentTypeFor(a.filename) }));
}

/** Largest file a template takes. Vercel refuses a request body over 4.5 MB, so the phone can't send more anyway. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export function encodeBytes(filename: string, bytes: Buffer, contentType?: string | null): PresetAttachment {
  return {
    id: crypto.randomUUID(),
    filename,
    content: bytes.toString("base64"),
    contentType: contentType && contentType !== "application/octet-stream" ? contentType : contentTypeFor(filename),
  };
}

/**
 * Reads an uploaded preset attachment (pricing sheet, portfolio sample, vCard)
 * into a PresetAttachment — the bytes are stored inline (base64) on the preset
 * row itself rather than in external storage, so every send reuses this exact
 * same stored copy with no extra network fetch. See the schema comment on
 * messagePresets.attachments for why this replaced a Vercel Blob URL.
 */
export async function encodeAttachment(file: File): Promise<PresetAttachment> {
  return encodeBytes(file.name, Buffer.from(await file.arrayBuffer()), file.type);
}
