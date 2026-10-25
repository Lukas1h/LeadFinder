import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getPortfolioPrefill } from "@/app/portfolio-links/actions";
import { badRequest, isUuid, notFound } from "../../helpers";

/** `?agent=<id>` → what the builder fills in when an agent is picked: first name, area, brokerage, nearest jobs. */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const agent = new URL(req.url).searchParams.get("agent") ?? "";
  if (!agent) return badRequest("agent is required");
  if (!isUuid(agent)) return notFound();
  const prefill = await getPortfolioPrefill(agent);
  return prefill ? NextResponse.json(prefill) : notFound();
}
