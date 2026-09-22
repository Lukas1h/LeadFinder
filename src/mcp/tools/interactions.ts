import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  agentInteractions,
  agents,
  listings,
  INTERACTION_CHANNELS,
  INTERACTION_DIRECTIONS,
  INTERACTION_OUTCOMES,
  type InteractionChannel,
  type InteractionDirection,
  type InteractionOutcome,
} from "@/db/schema";
import { text, errorText } from "./shared";

/**
 * Everything that happened with an agent that isn't a templated send — calls
 * in either direction, texts and emails that happened outside the app, and
 * anything recorded after the fact.
 *
 * Stored as channel x direction x outcome rather than a flat list of every
 * combination, so "how many calls did I make this month" is a filter rather
 * than string-matching labels. Outcomes only mean something for calls
 * (answered/no_answer/voicemail) and for the app's own text handoff
 * (sent/not_sent, resolved by the prompt when you return to the app) — a
 * manually-logged text or email has no outcome, since replies are recorded as
 * their own inbound interaction rather than as a property of the outbound one.
 */
const CALL_OUTCOMES: InteractionOutcome[] = ["answered", "no_answer", "voicemail"];

function validateOutcome(
  channel: InteractionChannel,
  outcome: InteractionOutcome | null | undefined
): string | null {
  if (outcome == null) return null;
  if (channel === "call" && !CALL_OUTCOMES.includes(outcome)) {
    return `A call's outcome must be one of ${CALL_OUTCOMES.join(", ")}`;
  }
  if (channel !== "call" && CALL_OUTCOMES.includes(outcome)) {
    return `${outcome} only applies to a call`;
  }
  return null;
}

export function registerInteractionTools(server: McpServer): void {
  server.registerTool(
    "log_interaction",
    {
      title: "Log an agent interaction",
      description:
        "Records a call, text, email, or in-person meeting with an agent — in either direction, optionally tied to a listing, with a note and a backdatable time. Use this for anything that happened outside the app (a phone call, a text they sent you); templated sends made through the app log themselves. Calls take an outcome (answered/no_answer/voicemail); texts and emails don't, since a reply is logged as its own inbound interaction.",
      inputSchema: {
        agentId: z.string().uuid(),
        channel: z.enum(INTERACTION_CHANNELS),
        direction: z.enum(INTERACTION_DIRECTIONS).describe("outbound = Lukas reached out, inbound = the agent did"),
        outcome: z.enum(INTERACTION_OUTCOMES).nullable().optional().describe("Calls only"),
        note: z.string().optional(),
        listingId: z.string().uuid().nullable().optional().describe("The property it was about, if any"),
        occurredAt: z.string().datetime().optional().describe("ISO timestamp; defaults to now"),
      },
    },
    async ({ agentId, channel, direction, outcome, note, listingId, occurredAt }) => {
      const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
      if (!agent) return errorText("No agent with that id");

      const outcomeError = validateOutcome(channel, outcome);
      if (outcomeError) return errorText(outcomeError);

      if (listingId) {
        const [listing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.id, listingId));
        if (!listing) return errorText("No listing with that id");
      }

      const at = occurredAt ? new Date(occurredAt) : new Date();
      const [row] = await db
        .insert(agentInteractions)
        .values({
          agentId,
          listingId: listingId ?? null,
          channel,
          direction,
          outcome: outcome ?? null,
          note: note?.trim() || null,
          occurredAt: at,
          source: "manual",
        })
        .returning();

      // Reaching out counts as contact even when it happened elsewhere, so the
      // agent stops reading as never-contacted after a phone call.
      if (direction === "outbound") {
        await db.update(agents).set({ lastContactedAt: at }).where(eq(agents.id, agentId));
      }

      return text(row);
    }
  );

  server.registerTool(
    "update_interaction",
    {
      title: "Edit a logged interaction",
      description:
        "Corrects an existing interaction — its channel, direction, outcome, note, linked listing, or when it happened. Only provided fields change. Also the way to answer an interaction the app parked as unconfirmed: setting an outcome clears that state.",
      inputSchema: {
        id: z.string().uuid(),
        channel: z.enum(INTERACTION_CHANNELS).optional(),
        direction: z.enum(INTERACTION_DIRECTIONS).optional(),
        outcome: z.enum(INTERACTION_OUTCOMES).nullable().optional(),
        note: z.string().nullable().optional(),
        listingId: z.string().uuid().nullable().optional(),
        occurredAt: z.string().datetime().optional(),
      },
    },
    async ({ id, channel, direction, outcome, note, listingId, occurredAt }) => {
      const [existing] = await db.select().from(agentInteractions).where(eq(agentInteractions.id, id));
      if (!existing) return errorText("No interaction with that id");

      const effectiveChannel = (channel ?? existing.channel) as InteractionChannel;
      const effectiveOutcome = outcome !== undefined ? outcome : existing.outcome;
      const outcomeError = validateOutcome(effectiveChannel, effectiveOutcome);
      if (outcomeError) return errorText(outcomeError);

      if (listingId) {
        const [listing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.id, listingId));
        if (!listing) return errorText("No listing with that id");
      }

      const patch: Partial<typeof agentInteractions.$inferInsert> = {};
      if (channel !== undefined) patch.channel = channel as InteractionChannel;
      if (direction !== undefined) patch.direction = direction as InteractionDirection;
      if (outcome !== undefined) patch.outcome = outcome;
      if (note !== undefined) patch.note = note?.trim() || null;
      if (listingId !== undefined) patch.listingId = listingId;
      if (occurredAt !== undefined) patch.occurredAt = new Date(occurredAt);
      // Giving it an outcome is exactly the answer the app was waiting for.
      if (outcome != null) patch.pendingSince = null;

      if (Object.keys(patch).length === 0) return text(existing);

      const [updated] = await db
        .update(agentInteractions)
        .set(patch)
        .where(eq(agentInteractions.id, id))
        .returning();
      return text(updated);
    }
  );

  server.registerTool(
    "delete_interaction",
    {
      title: "Delete a logged interaction",
      description:
        "Permanently removes an interaction — for one logged by mistake. Deleting the record of a real conversation loses history nothing else holds, so prefer update_interaction to correct a wrong detail.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const [deleted] = await db.delete(agentInteractions).where(eq(agentInteractions.id, id)).returning();
      if (!deleted) return errorText("No interaction with that id");
      return text({ deleted: true, interaction: deleted });
    }
  );

  server.registerTool(
    "list_interactions",
    {
      title: "Query logged interactions",
      description:
        "Interactions filtered by agent, channel, direction, outcome, and date range, newest first. Omit agentId to query across everyone — e.g. every call placed this week, or everything still marked unconfirmed. Does NOT include templated sends made through the app; use get_agent for an agent's full history including those.",
      inputSchema: {
        agentId: z.string().uuid().optional(),
        channel: z.enum(INTERACTION_CHANNELS).optional(),
        direction: z.enum(INTERACTION_DIRECTIONS).optional(),
        outcome: z.enum(INTERACTION_OUTCOMES).optional(),
        pendingOnly: z
          .boolean()
          .optional()
          .describe("Only interactions the app started but whose outcome was never confirmed"),
        since: z.string().datetime().optional(),
        until: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ agentId, channel, direction, outcome, pendingOnly, since, until, limit }) => {
      // Filtered and limited in SQL rather than fetched and sliced in JS —
      // this table grows with every touch and an unfiltered scan is exactly
      // the shape that ran this app's database transfer quota out before.
      const conditions = [
        agentId ? eq(agentInteractions.agentId, agentId) : null,
        channel ? eq(agentInteractions.channel, channel) : null,
        direction ? eq(agentInteractions.direction, direction) : null,
        outcome ? eq(agentInteractions.outcome, outcome) : null,
        pendingOnly ? isNotNull(agentInteractions.pendingSince) : null,
        since ? gte(agentInteractions.occurredAt, new Date(since)) : null,
        until ? lte(agentInteractions.occurredAt, new Date(until)) : null,
      ].filter((c) => c !== null);

      const rows = await db
        .select({
          id: agentInteractions.id,
          occurredAt: agentInteractions.occurredAt,
          channel: agentInteractions.channel,
          direction: agentInteractions.direction,
          outcome: agentInteractions.outcome,
          note: agentInteractions.note,
          unconfirmed: isNotNull(agentInteractions.pendingSince),
          source: agentInteractions.source,
          agentId: agentInteractions.agentId,
          agentName: agents.name,
          listingAddress: listings.address,
        })
        .from(agentInteractions)
        .innerJoin(agents, eq(agentInteractions.agentId, agents.id))
        .leftJoin(listings, eq(agentInteractions.listingId, listings.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(agentInteractions.occurredAt))
        .limit(limit);

      return text(rows);
    }
  );
}
