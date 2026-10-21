import { requireAppAuth } from "@/lib/appApiAuth";
import { handlePhotoEditRequest } from "@/lib/photoEditRequest";

/** POST /api/app/v1/photo-editor/edit — the web editor's endpoint, for the iPhone app. */
export const maxDuration = 120;

export function POST(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return handlePhotoEditRequest(req);
}
