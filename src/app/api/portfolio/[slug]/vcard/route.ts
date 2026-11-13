import { db } from "@/db";
import { portfolioLinks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isPortlandArea } from "@/lib/agentPage";
import { lukasVcard } from "@/lib/agentVcard";

/**
 * The agent page's "Save contact": a real file rather than a data: URL,
 * which iPhone Safari won't open. Served inline as text/vcard, Safari shows
 * its "Add to Contacts" card; desktop browsers download it. Under the page's
 * slug only so it lives on the same host and path family; the card now depends
 * on the page's market, so its note and address follow the link's area.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [link] = await db.select({ content: portfolioLinks.content }).from(portfolioLinks).where(eq(portfolioLinks.slug, slug));
  return new Response(lukasVcard(isPortlandArea(link?.content?.area)), {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'inline; filename="Lukas Hahn Photographer.vcf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
