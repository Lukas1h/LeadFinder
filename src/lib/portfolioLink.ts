import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { PORTFOLIO_ORIGIN } from "@/lib/siteUrls";
import { portfolioLinks, type PortfolioContent } from "@/db/schema";

// Four letters/digits, used as /portfolio?i=<slug>: reads like a normal site
// page rather than a token made for one person. All 62 letters and digits,
// since it's only ever tapped, never typed: 62^4 ≈ 14.8M ids. Punctuation
// would add a little (66^4 ≈ 19M) but texting apps drop a trailing "." or
// "-" from a link. Links made before 2026-10-26 have 6-char slugs as a bare
// path (gallery/r host /<slug>) and keep working (proxy.ts).
const SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SLUG_LENGTH = 4;

function randomSlug(): string {
  let out = "";
  for (let i = 0; i < SLUG_LENGTH; i++) out += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  return out;
}

/** A fresh slug, guaranteed unused — collisions are astronomically rare at this length but checked anyway. */
async function uniqueSlug(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = randomSlug();
    const [existing] = await db.select({ id: portfolioLinks.id }).from(portfolioLinks).where(eq(portfolioLinks.slug, slug));
    if (!existing) return slug;
  }
  throw new Error("Couldn't find a free slug — try again");
}

export async function createPortfolioLink(agentId: string | null, content: PortfolioContent): Promise<{ slug: string }> {
  const slug = await uniqueSlug();
  await db.insert(portfolioLinks).values({ slug, agentId, content });
  return { slug };
}

/**
 * r.lukashahn.media/portfolio?i=<slug> — see proxy.ts. Older 6-char links
 * were a bare /<slug> (here or on gallery.lukashahn.art) and still work, and
 * are shown that way so a copied old link is the one the agent already has.
 */
export function portfolioUrl(slug: string): string {
  return slug.length === 6 ? `${PORTFOLIO_ORIGIN}/${slug}` : `${PORTFOLIO_ORIGIN}/portfolio?i=${slug}`;
}
