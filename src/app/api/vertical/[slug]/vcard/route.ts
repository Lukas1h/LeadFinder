import { eq } from "drizzle-orm";
import { db } from "@/db";
import { verticalLinks } from "@/db/schema";
import { getVertical, verticalVcard } from "@/lib/verticals";

/**
 * An other-verticals page's "Save contact": Lukas's Hahn Media card with that
 * vertical's title and note (lib/verticals.ts). A real file, not a data: URL,
 * for the same reason as the agent page's (/api/portfolio/[slug]/vcard).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [link] = await db.select({ vertical: verticalLinks.vertical }).from(verticalLinks).where(eq(verticalLinks.slug, slug));
  const v = link ? getVertical(link.vertical) : null;
  if (!v) return new Response("Not found", { status: 404 });
  return new Response(verticalVcard(v), {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'inline; filename="Lukas Hahn Photographer.vcf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
