import { randomInt } from "node:crypto";
import { db } from "@/db";
import { verticalLinks } from "@/db/schema";
import { PORTFOLIO_WORDS } from "@/lib/portfolioWords";
import { AGENT_PAGE_ORIGIN } from "@/lib/siteUrls";
import type { VerticalConfig } from "@/lib/verticals";

/** An unused word from PORTFOLIO_WORDS, or two once they're all taken (same scheme as agent pages, own namespace). */
export async function uniqueVerticalSlug(): Promise<string> {
  const taken = new Set((await db.select({ slug: verticalLinks.slug }).from(verticalLinks)).map((r) => r.slug));
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

/** lukashahn.media/<path>/<slug>: the main site forwards /<path>/* here, like /portfolio/*. */
export function verticalUrl(v: VerticalConfig, slug: string): string {
  return `${AGENT_PAGE_ORIGIN}/${v.path}/${slug}`;
}
