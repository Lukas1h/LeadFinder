import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { createPortfolioLinkAction, listPortfolioLinks } from "@/app/portfolio-links/actions";
import { isUuid, optionalString, readJson, withErrors, BadBody } from "../helpers";
import { parseContent } from "./content";

/**
 * Personalized agent pages (src/app/portfolio-links). Every handler here calls
 * the web's own actions, so the two can't drift. Nothing here contacts anyone:
 * making or saving a link only writes the link.
 */

/** The 50 newest links with visits, time on page, contact saves and Book taps. */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return NextResponse.json({ links: await listPortfolioLinks() });
}

/** `{ agentId?, content }` → `{ ok, slug, url }`. */
export const POST = withErrors(async (req: Request) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const body = await readJson(req);
  const agentId = optionalString(body.agentId, "agentId");
  if (agentId && !isUuid(agentId)) throw new BadBody("agentId must be an id");
  const saved = await createPortfolioLinkAction(agentId, parseContent(body.content));
  return NextResponse.json({ ok: true, ...saved });
});

