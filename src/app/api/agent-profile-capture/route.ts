import { z } from "zod";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { normalizeName, normalizePhone } from "@/lib/normalize";
import { parseHomesProfile } from "@/lib/homesProfile";

const body = z.object({ html: z.string().min(200), url: z.string().url() });

/**
 * Lukas's Tampermonkey userscript (scripts/userscripts/homes-agent-capture.user.js)
 * posts a homes.com agent profile page here whenever he visits one — Akamai
 * 403s a server-side fetch of the same page, so this rides along with his
 * own browsing instead of scraping it ourselves. Matched to an existing
 * agent by phone first, then by normalized name; nothing is created, since a
 * miss usually means the name on the page doesn't match how we have them.
 */
export async function POST(req: Request) {
  const secret = process.env.HOMES_CAPTURE_SECRET;
  if (!secret || req.headers.get("x-capture-secret") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });

  const profile = parseHomesProfile(parsed.data.html, parsed.data.url);
  if (!profile) return Response.json({ matched: false, reason: "Not a recognizable profile page" });

  const phone = profile.phone ? normalizePhone(profile.phone) : null;
  const name = profile.name ? normalizeName(profile.name) : null;
  const match =
    (phone &&
      (await db.query.agents.findFirst({ where: eq(agents.phone, phone) }))) ||
    (name &&
      (await db.query.agents.findFirst({
        where: and(or(isNull(agents.declinedAt)), eq(agents.name, profile.name!)),
      })));
  if (!match) return Response.json({ matched: false, reason: "No agent with that phone or name", profile });

  await db
    .update(agents)
    .set({
      homesUrl: profile.url,
      homesLicenseId: profile.licenseId ?? match.homesLicenseId,
      homesListingsPerYear: profile.dealsThisYear ?? match.homesListingsPerYear,
      homesAvgSalePrice: profile.avgSalePrice ?? match.homesAvgSalePrice,
      homesCapturedAt: new Date(),
      brokerage: match.brokerage ?? profile.brokerage,
    })
    .where(eq(agents.id, match.id));

  return Response.json({ matched: true, agentId: match.id, agentName: match.name, profile });
}
