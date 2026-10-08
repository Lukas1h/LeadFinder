import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { draftAiPresetOption } from "@/app/messageActions";
import { PRESET_TYPES } from "@/db/schema";
import { isUuid, notFound, oneOf, optionalString, readJson, withErrors } from "../../../helpers";

// Drafts a real message, so it needs the same headroom the web's dialog has.
export const maxDuration = 60;

/**
 * Actually draft the AI option for a listing — the expensive call the
 * placeholder in GET message-options deliberately doesn't make. `instruction`
 * is Lukas steering this particular redraft ("shorter", "mention the drone
 * shot"), the same field the web's Regenerate control passes.
 *
 * Drafts only. This sends nothing; the app then hands the text to the iOS
 * Messages sheet and reports the result back through /texts.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);
  const type = oneOf(body.type, PRESET_TYPES, "type");
  const instruction = optionalString(body.instruction, "instruction");

  const option = await draftAiPresetOption(id, type, instruction ?? undefined);
  if (!option) return notFound();

  return NextResponse.json({ option });
});
