import { requireAppAuth } from "@/lib/appApiAuth";
import { listPresets, patchPreset } from "@/app/messaging/actions";
import { BadBody, badRequest, isUuid, notFound, readJson, withErrors } from "../../helpers";

/**
 * Edit a template. Send only what changed: `name`, `enabled`, `secondMessage`
 * (null clears it) and `quickActionPresetIds` (the whole ordered list). The
 * recommendation criteria are edited on the web. Returns the template as
 * GET ../ lists it.
 */
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);
  const input: Parameters<typeof patchPreset>[1] = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string") throw new BadBody("name must be a string");
    input.name = body.name;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw new BadBody("enabled must be true or false");
    input.enabled = body.enabled;
  }
  if (body.secondMessage !== undefined) {
    if (body.secondMessage !== null && typeof body.secondMessage !== "string") {
      throw new BadBody("secondMessage must be a string or null");
    }
    input.secondMessage = body.secondMessage;
  }
  if (body.quickActionPresetIds !== undefined) {
    const ids = body.quickActionPresetIds;
    if (!Array.isArray(ids) || !ids.every((v): v is string => typeof v === "string" && isUuid(v))) {
      throw new BadBody("quickActionPresetIds must be an array of template ids");
    }
    input.quickActionPresetIds = ids;
  }

  const result = await patchPreset(id, input);
  if (result.error === "Preset not found") return notFound();
  if (result.error) return badRequest(result.error);

  const preset = (await listPresets()).find((p) => p.id === id);
  return preset ? Response.json({ preset }) : notFound();
});
