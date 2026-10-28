import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { portfolioLinks } from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { portfolioUrl } from "@/lib/portfolioLink";
import { portfolioLinkTexts, recordPortfolioLinkText } from "@/app/messaging/replyActions";
import { badRequest, isUuid, notFound, withErrors } from "../../../helpers";

/**
 * Texting a portfolio link to its agent, from the builder's "Text it":
 *
 * - GET → `{ first, second, phone }`: the two texts to send, in order (the
 *   "Portfolio link" template's body, then its second message with the link).
 *   No side effects.
 * - POST, once Messages reports both sent → records them: one send in the
 *   agent's message history and their last message marked replied.
 *
 * This sends nothing itself.
 */
async function load(req: Request, params: Promise<{ id: string }>): Promise<{ response: Response } | { agentId: string; url: string }> {
  const denied = requireAppAuth(req);
  if (denied) return { response: denied };
  const { id } = await params;
  if (!isUuid(id)) return { response: notFound() };
  const [link] = await db.select({ slug: portfolioLinks.slug, agentId: portfolioLinks.agentId }).from(portfolioLinks).where(eq(portfolioLinks.id, id));
  if (!link) return { response: notFound() };
  if (!link.agentId) return { response: badRequest("This link has no agent attached") };
  return { agentId: link.agentId, url: portfolioUrl(link.slug) };
}

export const GET = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const l = await load(req, params);
  if ("response" in l) return l.response;
  const texts = await portfolioLinkTexts(l.agentId, l.url);
  if (texts.error) return badRequest(texts.error);
  return NextResponse.json({ first: texts.first, second: texts.second || null, phone: texts.phone });
});

export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const l = await load(req, params);
  if ("response" in l) return l.response;
  const result = await recordPortfolioLinkText(l.agentId, l.url, true);
  if (result.error) return badRequest(result.error);
  return NextResponse.json({ ok: true });
});
