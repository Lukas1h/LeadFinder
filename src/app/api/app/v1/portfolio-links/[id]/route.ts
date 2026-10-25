import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getPortfolioActivity, updatePortfolioLinkAction } from "@/app/portfolio-links/actions";
import { BadBody, isUuid, notFound, optionalString, readJson, withErrors, badRequest } from "../../helpers";
import { parseContent } from "../content";

/** One link's activity: every visit, how long, how far, per-section seconds and taps. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const activity = await getPortfolioActivity(id);
  if (!activity) return notFound();
  return NextResponse.json({ activity });
}

/** Saves the builder over an existing link: same URL, same activity. `{ agentId?, content }`. */
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const body = await readJson(req);
  const agentId = optionalString(body.agentId, "agentId");
  if (agentId && !isUuid(agentId)) throw new BadBody("agentId must be an id");
  try {
    return NextResponse.json({ ok: true, ...(await updatePortfolioLinkAction(id, agentId, parseContent(body.content))) });
  } catch (err) {
    // "That link no longer exists" is the only thing the action throws.
    return badRequest(err instanceof Error ? err.message : "Couldn't save the link");
  }
});
