import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { resolvePendingInteraction, startPendingInteraction } from "@/app/agents/interactionActions";
import { isUuid, notFound, withErrors } from "../../../helpers";

/**
 * Record a text sent to an agent directly (no listing behind it) — the app's
 * equivalent of the agent row's Text button.
 *
 * Confirms on the spot for the same reason /listings/:id/texts does: the
 * native composer told us it was sent, so there's no "did it go?" prompt to
 * park it for. startPendingInteraction still writes the outbound interaction,
 * so the text shows up in the timeline exactly as the web's does.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const interactionId = await startPendingInteraction({ agentId: id, channel: "text" });
  if (interactionId) await resolvePendingInteraction(interactionId, "sent");

  return NextResponse.json({ ok: true, interactionId });
});
