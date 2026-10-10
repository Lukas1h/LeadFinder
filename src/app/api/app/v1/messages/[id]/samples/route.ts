import { requireAppAuth } from "@/lib/appApiAuth";
import { getSendDetail, sendQuickActionEmail } from "@/app/messaging/replyActions";
import { badRequest, isUuid, notFound, optionalString, readJson, withErrors } from "../../../helpers";

/**
 * "Send samples", as app builds from before quick actions call it: the
 * template's first email quick action. Newer builds use
 * ./quick-actions/:presetId, which this now simply forwards to.
 *
 * **This sends real email.** It is only ever called from the app's confirm
 * dialog, which names the preset and the address first.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const detail = await getSendDetail(id);
  if (!detail) return notFound();
  const action = detail.quickActions.find((a) => a.channel === "email");
  if (!action) return badRequest("This template has no email quick action");

  const body = await readJson(req);
  const result = await sendQuickActionEmail(id, action.presetId, optionalString(body.email, "email") ?? undefined);
  if (result.error) return badRequest(result.error);

  return Response.json({ ok: true, note: result.note ?? null });
});
