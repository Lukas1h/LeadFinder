import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { AGENT_PAGE_ORIGIN, PORTFOLIO_ORIGIN } from "@/lib/siteUrls";
import { PORTFOLIO_WORDS, isWordSlug } from "@/lib/portfolioWords";
import { portfolioLinks, type PortfolioContent } from "@/db/schema";

/**
 * A fresh slug: an unused word from PORTFOLIO_WORDS ("cedar"), or two of them
 * ("cedar-ridge") once every single word is taken. Links made before
 * 2026-10-28 have random slugs (6 chars as a bare path, then 4 chars as
 * ?i=) and keep working (proxy.ts).
 */
async function uniqueSlug(): Promise<string> {
  const taken = new Set((await db.select({ slug: portfolioLinks.slug }).from(portfolioLinks)).map((r) => r.slug));
  const free = PORTFOLIO_WORDS.filter((w) => !taken.has(w));
  if (free.length > 0) return free[randomInt(free.length)];
  for (let attempt = 0; attempt < 50; attempt++) {
    const a = PORTFOLIO_WORDS[randomInt(PORTFOLIO_WORDS.length)];
    const b = PORTFOLIO_WORDS[randomInt(PORTFOLIO_WORDS.length)];
    const slug = `${a}-${b}`;
    if (a !== b && !taken.has(slug)) return slug;
  }
  throw new Error("Couldn't find a free slug — try again");
}

export async function createPortfolioLink(agentId: string | null, content: PortfolioContent): Promise<{ id: string; slug: string }> {
  const slug = await uniqueSlug();
  const [row] = await db.insert(portfolioLinks).values({ slug, agentId, content }).returning({ id: portfolioLinks.id });
  return { id: row.id, slug };
}

/**
 * lukashahn.media/portfolio/<word>: on the main site's own domain (its
 * project forwards /portfolio/* here, see AGENT_PAGE_ORIGIN). Older random
 * slugs are shown as they were sent: 6 chars as r.lukashahn.media/<slug>,
 * 4 chars as r.lukashahn.media/portfolio?i=<slug>.
 */
export function portfolioUrl(slug: string): string {
  if (isWordSlug(slug)) return `${AGENT_PAGE_ORIGIN}/portfolio/${slug}`;
  return slug.length === 6 ? `${PORTFOLIO_ORIGIN}/${slug}` : `${PORTFOLIO_ORIGIN}/portfolio?i=${slug}`;
}
