import { requireAppAuth } from "@/lib/appApiAuth";
import { toggleVariant, updateVariant } from "@/app/messaging/actions";
import { BadBody, badRequest, isUuid, notFound, optionalString, readJson, requiredString, withErrors } from "../../../helpers";

/**
 * Edit one variant's wording: `label`, `body`, and `subject` for an email, all
 * three sent together. `enabled` alone switches it in or out of the rotation.
 */
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ variantId: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { variantId } = await params;
  if (!isUuid(variantId)) return notFound();

  const body = await readJson(req);
  if (body.body !== undefined || body.label !== undefined) {
    const result = await updateVariant(variantId, {
      label: requiredString(body.label, "label"),
      body: requiredString(body.body, "body"),
      subject: optionalString(body.subject, "subject") ?? undefined,
    });
    if (result.error) return badRequest(result.error);
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw new BadBody("enabled must be true or false");
    await toggleVariant(variantId, body.enabled);
  }
  return Response.json({ ok: true });
});
