import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAppAuth } from "@/lib/appApiAuth";
import { removePresetAttachment } from "@/app/messaging/actions";
import { contentTypeFor } from "@/lib/attachments";
import { isUuid, notFound } from "../../../../helpers";

type Params = { params: Promise<{ id: string; attachmentId: string }> };

/**
 * One attachment's bytes, for the app to put in the Messages composer. An
 * attachment never changes once uploaded (replacing one makes a new id), so the
 * app can keep it on disk by id for good.
 */
export async function GET(req: Request, { params }: Params) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id, attachmentId } = await params;
  if (!isUuid(id) || !isUuid(attachmentId)) return notFound();

  // Picked out in SQL: reading the whole column would pull every other file too.
  const result = await db.execute(sql`
    select a->>'filename' as filename, a->>'contentType' as content_type, a->>'content' as content
    from message_presets p, jsonb_array_elements(p.attachments) a
    where p.id = ${id} and a->>'id' = ${attachmentId}
    limit 1
  `);
  const row = result.rows[0] as { filename: string; content_type: string | null; content: string } | undefined;
  if (!row) return notFound();

  return new Response(Buffer.from(row.content, "base64"), {
    headers: {
      "Content-Type": row.content_type || contentTypeFor(row.filename),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function DELETE(req: Request, { params }: Params) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id, attachmentId } = await params;
  if (!isUuid(id) || !isUuid(attachmentId)) return notFound();

  const result = await removePresetAttachment(id, attachmentId);
  if (result.error) return notFound();
  return Response.json({ ok: true });
}
