import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getPortfolioLinkForEdit } from "@/app/portfolio-links/actions";
import { isUuid, notFound } from "../../../helpers";

/** A link as the builder's starting state: `{ linkId, url, agent, content }`. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const link = await getPortfolioLinkForEdit(id);
  return link ? NextResponse.json(link) : notFound();
}
