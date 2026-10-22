import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { portfolioLinks, type PortfolioContent } from "@/db/schema";

// Mixed-case + digits, no 0/O/1/l/I — short and typed by hand without ambiguity
// if someone ever reads it off a screen, though it's only ever a tap.
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
const SLUG_LENGTH = 6;

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

/** gallery.lukashahn.art, where this and the real client galleries both live — see proxy.ts. */
export function portfolioUrl(slug: string): string {
  return `https://gallery.lukashahn.art/${slug}`;
}
