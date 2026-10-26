import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { portfolioLinks, type PortfolioContent } from "@/db/schema";
import { AGENT_PAGE_PHOTOS } from "@/lib/agentPage";
import { createPortfolioLink, portfolioUrl } from "@/lib/portfolioLink";
import { getPortfolioPrefill } from "@/app/portfolio-links/actions";

/**
 * The link a "Portfolio link" text sends ({{portfolioLink}}): the agent's
 * newest portfolio page, or a new one made the way the builder prefills it
 * (their first name, area, brokerage and Lukas's nearest jobs) when they have
 * none. Reusing the newest keeps one agent on one link, so its visits stay in
 * one place.
 */
export async function portfolioLinkFor(agentId: string): Promise<string> {
  const [existing] = await db
    .select({ slug: portfolioLinks.slug })
    .from(portfolioLinks)
    .where(eq(portfolioLinks.agentId, agentId))
    .orderBy(desc(portfolioLinks.createdAt))
    .limit(1);
  if (existing) return portfolioUrl(existing.slug);

  const prefill = await getPortfolioPrefill(agentId);
  const content: PortfolioContent = {
    area: prefill?.area ?? null,
    agentFirstName: prefill?.firstName || null,
    brokerage: prefill?.brokerage || null,
    video: "summit",
    leadPhoto: AGENT_PAGE_PHOTOS[0].key,
    showTourOfHomes: true,
    showOffer: true,
    beforeAfter: false,
    listings: prefill?.listings ?? [],
  };
  const { slug } = await createPortfolioLink(agentId, content);
  return portfolioUrl(slug);
}
