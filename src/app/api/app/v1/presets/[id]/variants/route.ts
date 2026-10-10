import { requireAppAuth } from "@/lib/appApiAuth";
import { createVariant } from "@/app/messaging/actions";
import { badRequest, isUuid, notFound, optionalString, readJson, requiredString, withErrors } from "../../../helpers";

/** Add a variant to a template: `label`, `body`, and `subject` for an email. */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);
  const result = await createVariant(id, {
    label: requiredString(body.label, "label"),
    body: requiredString(body.body, "body"),
    subject: optionalString(body.subject, "subject") ?? undefined,
  });
  if (result.error) return badRequest(result.error);
  return Response.json({ ok: true });
});
