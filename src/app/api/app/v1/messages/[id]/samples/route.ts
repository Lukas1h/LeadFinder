import { requireAppAuth } from "@/lib/appApiAuth";
import { sendSamplesForSend } from "@/app/messaging/replyActions";
import { badRequest, isUuid, notFound, optionalString, readJson, withErrors } from "../../../helpers";

/**
 * "Send samples" from the message screen: emails the preset's follow-up
 * template to the agent and records the reply — the web's own
 * sendSamplesForSend, so the two can't drift.
 *
 * **This sends real email.** It is only ever called from the app's confirm
 * dialog, which names the preset and the address first. `email` is read only
 * when the agent has none on file; the web saves it to the agent if it's new.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);
  const result = await sendSamplesForSend(id, optionalString(body.email, "email") ?? undefined);
  if (result.error) return badRequest(result.error);

  return Response.json({ ok: true, note: result.note ?? null });
});
