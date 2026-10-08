import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getMessageOptions } from "@/app/messageActions";
import { PRESET_TYPES } from "@/db/schema";
import { badRequest, isUuid, notFound, withErrors } from "../../../helpers";

// No Gemini call happens here (the AI draft stays a placeholder until
// /ai-draft), but this is the same query the web's dialog runs, so it gets the
// same headroom rather than depending on that staying true.
export const maxDuration = 60;

/**
 * The presets available for a listing, exactly as the Send message dialog lists
 * them — including the "AI Draft" placeholder (variantId "draft", empty text),
 * which is what the app shows as a choice and then asks
 * POST /listings/:id/ai-draft to fill in. Drafting stays on demand so opening
 * the picker doesn't spend a Gemini call.
 */
export const GET = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const type = new URL(req.url).searchParams.get("type");
  if (!type || !(PRESET_TYPES as readonly string[]).includes(type)) {
    return badRequest(`type must be one of: ${PRESET_TYPES.join(", ")}`);
  }

  const options = await getMessageOptions(id, type as (typeof PRESET_TYPES)[number]);
  if (options.presets.length === 0) return notFound();

  return NextResponse.json({ presets: options.presets });
});
