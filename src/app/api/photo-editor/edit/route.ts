import { handlePhotoEditRequest } from "@/lib/photoEditRequest";

// One photo per request: an edit takes 10-20 s, plus Gemini's own retry
// waits on a 429, and the page runs a few of these side by side.
export const maxDuration = 120;

export function POST(req: Request) {
  return handlePhotoEditRequest(req);
}
