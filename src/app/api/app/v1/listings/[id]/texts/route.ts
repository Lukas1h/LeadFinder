import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { sendMessage } from "@/app/messageActions";
import { resolvePendingInteraction } from "@/app/agents/interactionActions";
import { PRESET_TYPES } from "@/db/schema";
import { isUuid, notFound, oneOf, readJson, requiredString, withErrors } from "../../../helpers";

/**
 * Record a text that the native Messages composer reported as sent.
 *
 * Why this confirms immediately, unlike the web: the web hands off through an
 * sms: link, which cannot report back, so it parks the send as "pending" and
 * asks "did you send it?" when you return. The iOS composer does report back,
 * so there is nothing to ask — the text is confirmed here and nothing lands in
 * the web's prompt. (The web can still Undo one of these from its own prompt,
 * because resolvePendingInteraction takes an outcome.)
 *
 * This logs a send. It does not send anything — no email or text leaves the
 * server here; the app already handed the message to Messages.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);
  const type = oneOf(body.type, PRESET_TYPES, "type");
  const presetId = requiredString(body.presetId, "presetId");
  const variantId = requiredString(body.variantId, "variantId");
  const text = requiredString(body.text, "text");

  const { pendingInteractionId } = await sendMessage(id, type, presetId, variantId, text);
  if (pendingInteractionId) {
    await resolvePendingInteraction(pendingInteractionId, "sent");
  }

  return NextResponse.json({ ok: true, interactionId: pendingInteractionId });
});
