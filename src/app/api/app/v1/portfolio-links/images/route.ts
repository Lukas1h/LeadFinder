import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { uploadPortfolioImage } from "@/app/portfolio-links/actions";
import { badRequest } from "../../helpers";

/**
 * A before/after photo from the phone: multipart with a `file` part (an image,
 * 8 MB at most; the app sends ~2400px JPEG). `{ url }` is the path the web
 * stores, "/api/portfolio-image/<id>"; the app prefixes the portfolio origin.
 */
export async function POST(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("expected a multipart body with a file");
  }
  try {
    return NextResponse.json({ ok: true, ...(await uploadPortfolioImage(form)) });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Upload failed");
  }
}
