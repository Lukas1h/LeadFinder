import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getAgentListingPhotos } from "@/app/portfolio-links/actions";
import { badRequest, isUuid, notFound } from "../../helpers";

/** `?agent=<id>` → every photo from every listing of theirs on file, grouped by listing, newest first. */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const agent = new URL(req.url).searchParams.get("agent") ?? "";
  if (!agent) return badRequest("agent is required");
  if (!isUuid(agent)) return notFound();
  return NextResponse.json({ groups: await getAgentListingPhotos(agent) });
}
