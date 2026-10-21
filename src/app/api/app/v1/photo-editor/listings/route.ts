import { requireAppAuth } from "@/lib/appApiAuth";
import { searchEditorListings } from "@/app/photo-editor/actions";

/** GET /api/app/v1/photo-editor/listings?q= — listings by street, city or agent, for the editor's search. */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ listings: await searchEditorListings(q) });
}
