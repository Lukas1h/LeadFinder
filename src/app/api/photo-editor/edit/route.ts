import { handlePhotoEditRequest } from "@/lib/photoEditRequest";

// One photo per request: a 2K edit takes 10-25 s, plus Gemini's own retry
// waits on a 429, and the page runs a few of these side by side.
export const maxDuration = 120;

export function POST(req: Request) {
  return handlePhotoEditRequest(req);
}
