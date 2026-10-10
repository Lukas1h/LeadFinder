import { requireAppAuth } from "@/lib/appApiAuth";
import { addPresetAttachment, listPresets } from "@/app/messaging/actions";
import { encodeBytes, MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import { badRequest, isUuid, notFound, withErrors } from "../../../helpers";

/**
 * Attach a file to a template. The request body is the file itself, not JSON
 * and not a form: `Content-Type` is its type and the name goes in the
 * `X-Filename` header, percent-encoded. One file per request, 4 MB at most —
 * the app shrinks a photo to fit before sending. Returns the template's
 * attachments as GET ../../ lists them.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  let filename: string;
  try {
    filename = decodeURIComponent(req.headers.get("x-filename") ?? "").trim();
  } catch {
    return badRequest("X-Filename must be percent-encoded");
  }
  if (!filename) return badRequest("X-Filename is required");

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) return badRequest("The file is empty");
  if (bytes.length > MAX_ATTACHMENT_BYTES) return badRequest("File is too large (max 4 MB)");

  const result = await addPresetAttachment(id, encodeBytes(filename, bytes, req.headers.get("content-type")?.split(";")[0]));
  if (result.error) return notFound();

  const preset = (await listPresets()).find((p) => p.id === id);
  return Response.json({ attachments: preset?.attachments ?? [] });
});
