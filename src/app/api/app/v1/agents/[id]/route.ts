import { NextResponse } from "next/server";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAppAuth } from "@/lib/appApiAuth";
import { brokerageByAgent } from "@/lib/agentBrokerage";
import { getAgentTimeline } from "@/app/agents/interactionActions";
import { getAgentListings } from "@/app/agents/actions";
import { getAgentBookings } from "@/app/booked/actions";
import { updateAgentNotes, updateAgentRelationshipStatus } from "@/app/agents/actions";
import { agentJson, bookingJson, listingJson } from "../../serialize";
import { isUuid, notFound, optionalString, oneOf, readJson, withErrors } from "../../helpers";
import { AGENT_RELATIONSHIP_STATUSES } from "@/db/schema";

/**
 * One agent: who they are, everything that's happened with them, their
 * listings, and their bookings — the same three sources AgentDetailDialog
 * reads, so the app's agent screen matches the web's dialog.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) return notFound();

  const [brokerage, timeline, listings, bookings] = await Promise.all([
    brokerageByAgent(),
    getAgentTimeline(id),
    getAgentListings(id),
    getAgentBookings(id),
  ]);

  return NextResponse.json({
    agent: agentJson(agent),
    brokerage: brokerage.get(id) ?? null,
    timeline,
    listings: listings.map((l) => listingJson(l, "all")),
    bookings: bookings.map(bookingJson),
  });
}

/**
 * Edit an agent from the app. Both fields are optional, so a caller that only
 * wants to change one sends just that one; the underlying actions revalidate
 * the web pages exactly as the web's own edit controls do.
 */
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);

  if (body.relationshipStatus != null) {
    await updateAgentRelationshipStatus(id, oneOf(body.relationshipStatus, AGENT_RELATIONSHIP_STATUSES, "relationshipStatus"));
  }
  if (body.notes !== undefined) {
    await updateAgentNotes(id, optionalString(body.notes, "notes") ?? "");
  }

  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) return notFound();

  return NextResponse.json({ ok: true, agent: agentJson(agent) });
});
