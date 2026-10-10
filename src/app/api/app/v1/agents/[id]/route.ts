import { NextResponse } from "next/server";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAppAuth } from "@/lib/appApiAuth";
import { brokerageByAgent } from "@/lib/agentBrokerage";
import { getAgentTimeline } from "@/app/agents/interactionActions";
import { getAgentListings } from "@/app/agents/actions";
import { getAgentBookings } from "@/app/booked/actions";
import { deleteAgent, updateAgentContactInfo, updateAgentNotes, updateAgentStats } from "@/app/agents/actions";
import { agentJson, bookingJson, listingJson } from "../../serialize";
import { badRequest, isUuid, notFound, optionalString, oneOf, readJson, withErrors } from "../../helpers";
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
 * Edit an agent from the app — the web's Edit form: name, phone, email,
 * relationship, brokerage and notes. Every field is optional, so a caller that
 * only wants to change one sends just that one; anything left out keeps its
 * current value. The web's own actions do the validation (at least one of
 * phone/email, formats, "another agent already has this number") and
 * revalidate the pages, so the app can't save what the web wouldn't.
 *
 * A blank string clears name, phone, email, brokerage or notes.
 */
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);
  const [current] = await db.select().from(agents).where(eq(agents.id, id));
  if (!current) return notFound();

  const text = (field: string, existing: string | null) =>
    body[field] === undefined ? (existing ?? "") : (optionalString(body[field], field) ?? "");

  const contactChanged = ["name", "phone", "email", "relationshipStatus"].some((f) => body[f] !== undefined);
  if (contactChanged) {
    const result = await updateAgentContactInfo(id, {
      name: text("name", current.name),
      phone: text("phone", current.phone),
      email: text("email", current.email),
      relationshipStatus:
        body.relationshipStatus === undefined
          ? current.relationshipStatus
          : oneOf(body.relationshipStatus, AGENT_RELATIONSHIP_STATUSES, "relationshipStatus"),
    });
    if (result.error) return badRequest(result.error);
  }

  if (body.brokerage !== undefined) {
    await updateAgentStats(id, {
      avgListingsPerYear: current.avgListingsPerYear,
      avgListingPrice: current.avgListingPrice,
      avgDaysBetweenListings: current.avgDaysBetweenListings,
      brokerage: text("brokerage", current.brokerage),
    });
  }

  if (body.notes !== undefined) {
    await updateAgentNotes(id, text("notes", current.notes));
  }

  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) return notFound();

  return NextResponse.json({ ok: true, agent: agentJson(agent) });
});

/**
 * Delete an agent outright, as the web's Edit form does. Bookings and past
 * sends survive, just unlinked from them.
 */
export const DELETE = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  await deleteAgent(id);
  return NextResponse.json({ ok: true });
});
