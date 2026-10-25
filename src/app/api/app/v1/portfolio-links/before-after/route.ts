import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { saveBeforeAfter } from "@/app/portfolio-links/actions";
import { badRequest, readJson, requiredString, withErrors } from "../../helpers";

/**
 * `{ before, after }`, each a data: URL or a listing photo URL → `{ beforeSrc,
 * afterSrc }`, stored as page images (the photo editor's "Use as before/after").
 */
export const POST = withErrors(async (req: Request) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const body = await readJson(req);
  try {
    const saved = await saveBeforeAfter({
      before: requiredString(body.before, "before"),
      after: requiredString(body.after, "after"),
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Couldn't save the before/after");
  }
});
