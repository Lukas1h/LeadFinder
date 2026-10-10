import { requireAppAuth } from "@/lib/appApiAuth";
import { listPresets } from "@/app/messaging/actions";

/**
 * Every template, for the phone's template editor: its variants, its
 * attachments (names and sizes, never the bytes — those come one at a time from
 * ./:id/attachments/:attachmentId) and its quick actions. Archived templates
 * are left out, as on the web.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  return Response.json({ presets: await listPresets() });
}
