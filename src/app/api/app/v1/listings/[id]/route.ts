import { NextResponse } from "next/server";
import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAppAuth } from "@/lib/appApiAuth";
import { agentJson, listingJson } from "../../serialize";
import { isUuid, notFound } from "../../helpers";

/**
 * One listing in full — every photo, unlike the list endpoints — plus the
 * agents row it's linked to. A listing with no linked agent still returns: the
 * app shows the listing's own agentName/agentPhone snapshot, and a 404 there
 * would be wrong.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [listing] = await db.select().from(listings).where(eq(listings.id, id));
  if (!listing) return notFound();

  const [agent] = listing.agentId
    ? await db.select().from(agents).where(eq(agents.id, listing.agentId))
    : [null];

  return NextResponse.json({
    listing: listingJson(listing, "all"),
    agent: agent ? agentJson(agent) : null,
  });
}
