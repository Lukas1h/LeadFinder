import { db } from "@/db";
import { agents, portfolioLinks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getMarkets } from "@/lib/marketsData";
import { lukasVcard } from "@/lib/agentVcard";
import { resolveLukasPhone } from "@/lib/lukasPhones";

/**
 * The agent page's "Save contact": a real file rather than a data: URL,
 * which iPhone Safari won't open. Served inline as text/vcard, Safari shows
 * its "Add to Contacts" card; desktop browsers download it. Under the page's
 * slug only so it lives on the same host and path family; the card now depends
 * on the page's market, so its note and address follow the link's area.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [link] = await db
    .select({ content: portfolioLinks.content, agentPhone: agents.phone })
    .from(portfolioLinks)
    .leftJoin(agents, eq(agents.id, portfolioLinks.agentId))
    .where(eq(portfolioLinks.slug, slug));
  const mk = await getMarkets();
  const shooter = mk.shooterMarketForArea(link?.content?.area);
  // The same number the page shows (its area falls back as the page does).
  const area = link?.content?.area?.trim() || "Eugene";
  const market = shooter ?? mk.get(mk.marketFor({ city: area }));
  const phone = resolveLukasPhone({
    myPhone: link?.content?.myPhone,
    agentPhone: link?.agentPhone,
    marketKey: market?.key,
    marketState: market?.state,
  });
  return new Response(lukasVcard(shooter, phone), {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'inline; filename="Lukas Hahn Photographer.vcf"',
      "Cache-Control": "public, max-age=300",
    },
  });
}
