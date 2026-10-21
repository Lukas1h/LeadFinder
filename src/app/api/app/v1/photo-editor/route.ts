import { requireAppAuth } from "@/lib/appApiAuth";
import { PHOTO_PRESETS } from "@/lib/photoPresets";

/** GET /api/app/v1/photo-editor — the presets the editor offers. */
export function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return Response.json({ presets: PHOTO_PRESETS.map(({ id, label, description }) => ({ id, label, description })) });
}
