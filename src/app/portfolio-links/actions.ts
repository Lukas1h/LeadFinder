"use server";

import { desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { agents, portfolioLinks, type PortfolioContent } from "@/db/schema";
import { createPortfolioLink, portfolioUrl } from "@/lib/portfolioLink";

export interface AgentMatch {
  id: string;
  name: string | null;
  phone: string | null;
  /** For prefilling the page's area and the "Book a shoot" text. */
  homeCity: string | null;
  brokerage: string | null;
}

export async function searchAgentsForPortfolio(query: string): Promise<AgentMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const like = `%${trimmed}%`;
  return db
    .select({ id: agents.id, name: agents.name, phone: agents.phone, homeCity: agents.homeCity, brokerage: agents.brokerage })
    .from(agents)
    .where(or(ilike(agents.name, like), ilike(agents.phone, like)))
    .orderBy(desc(agents.lastContactedAt))
    .limit(8);
}

export async function createPortfolioLinkAction(
  agentId: string | null,
  content: PortfolioContent
): Promise<{ slug: string; url: string }> {
  const { slug } = await createPortfolioLink(agentId, content);
  return { slug, url: portfolioUrl(slug) };
}

export interface PortfolioLinkSummary {
  id: string;
  slug: string;
  url: string;
  agentName: string | null;
  createdAt: Date;
  viewCount: number;
  lastViewedAt: Date | null;
}

export async function listPortfolioLinks(): Promise<PortfolioLinkSummary[]> {
  const rows = await db
    .select({
      id: portfolioLinks.id,
      slug: portfolioLinks.slug,
      agentName: agents.name,
      createdAt: portfolioLinks.createdAt,
      viewCount: portfolioLinks.viewCount,
      lastViewedAt: portfolioLinks.lastViewedAt,
    })
    .from(portfolioLinks)
    .leftJoin(agents, eq(agents.id, portfolioLinks.agentId))
    .orderBy(desc(portfolioLinks.createdAt))
    .limit(50);
  return rows.map((r) => ({ ...r, url: portfolioUrl(r.slug) }));
}
