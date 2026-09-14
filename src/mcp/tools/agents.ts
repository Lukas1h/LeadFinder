import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, desc, eq, ilike, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  listings,
  bookings,
  bookingLineItems,
  messagePresets,
  messageSends,
  AGENT_RELATIONSHIP_STATUSES,
  type AgentRelationshipStatus,
} from "@/db/schema";
import { text, errorText, normalizeContact } from "./shared";

export function registerAgentTools(server: McpServer): void {
  server.registerTool(
    "search_agents",
    {
      title: "Search agents",
      description:
        "Search LeadFinder's agent/realtor contacts by name/phone/email substring, relationship status, and contact-info presence. Returns up to `limit` matches, newest first by default.",
      inputSchema: {
        query: z.string().optional().describe("Substring to match against name, phone, or email"),
        relationshipStatus: z.enum(AGENT_RELATIONSHIP_STATUSES).optional(),
        hasEmail: z.boolean().optional().describe("true = only agents with an email on file, false = only those without"),
        hasPhone: z.boolean().optional().describe("true = only agents with a phone on file, false = only those without"),
        declinedOnly: z.boolean().optional().describe("Only agents with declinedAt set"),
        sortBy: z.enum(["newest", "oldest", "last_contacted", "name"]).default("newest"),
        limit: z.number().int().min(1).max(200).default(20),
      },
    },
    async ({ query, relationshipStatus, hasEmail, hasPhone, declinedOnly, sortBy, limit }) => {
      const conditions = [];
      if (query) {
        const like = `%${query}%`;
        conditions.push(or(ilike(agents.name, like), ilike(agents.phone, like), ilike(agents.email, like)));
      }
      if (relationshipStatus) conditions.push(eq(agents.relationshipStatus, relationshipStatus));
      if (hasEmail === true) conditions.push(isNotNull(agents.email));
      if (hasPhone === true) conditions.push(isNotNull(agents.phone));
      if (declinedOnly) conditions.push(isNotNull(agents.declinedAt));

      let rows = await db
        .select()
        .from(agents)
        .where(conditions.length ? and(...conditions) : undefined);

      if (hasEmail === false) rows = rows.filter((a) => !a.email);
      if (hasPhone === false) rows = rows.filter((a) => !a.phone);

      const sorted = [...rows].sort((a, b) => {
        switch (sortBy) {
          case "oldest":
            return a.createdAt.getTime() - b.createdAt.getTime();
          case "last_contacted": {
            const at = a.lastContactedAt?.getTime() ?? -Infinity;
            const bt = b.lastContactedAt?.getTime() ?? -Infinity;
            return bt - at;
          }
          case "name":
            return (a.name ?? "").localeCompare(b.name ?? "");
          case "newest":
          default:
            return b.createdAt.getTime() - a.createdAt.getTime();
        }
      });

      return text(sorted.slice(0, limit));
    }
  );

  server.registerTool(
    "get_agent",
    {
      title: "Get agent detail",
      description:
        "Full detail for one agent by id, phone, or email — the agent row, every listing tied to their phone, and their send history. Exactly one of id/phone/email must be given.",
      inputSchema: {
        id: z.string().uuid().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
      },
    },
    async ({ id, phone, email }) => {
      if (!id && !phone && !email) return errorText("Provide one of id, phone, or email");

      const condition = id ? eq(agents.id, id) : phone ? eq(agents.phone, phone) : eq(agents.email, email!);
      const [agent] = await db.select().from(agents).where(condition);
      if (!agent) return errorText("No agent found matching that id/phone/email");

      const agentListings = agent.phone
        ? await db.select().from(listings).where(eq(listings.agentPhone, agent.phone))
        : [];

      const history = await db
        .select({
          id: messageSends.id,
          presetName: messagePresets.name,
          channel: messageSends.channel,
          type: messageSends.type,
          sentAt: messageSends.sentAt,
          respondedAt: messageSends.respondedAt,
          result: messageSends.result,
        })
        .from(messageSends)
        .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
        .where(eq(messageSends.agentId, agent.id))
        .orderBy(desc(messageSends.sentAt));

      const agentBookings = await db.select().from(bookings).where(eq(bookings.contactAgentId, agent.id));

      return text({ agent, listings: agentListings, sendHistory: history, bookings: agentBookings });
    }
  );

  server.registerTool(
    "check_contact_history",
    {
      title: "Check whether an agent has already been contacted",
      description:
        "Given an email or phone, reports whether this person is already a known agent and, if so, when they were last contacted and their send history — use this BEFORE send_agent_email to decide whether a duplicate-send warning is worth surfacing to the user.",
      inputSchema: {
        email: z.string().optional(),
        phone: z.string().optional(),
      },
    },
    async ({ email, phone }) => {
      if (!email && !phone) return errorText("Provide an email or phone");

      const condition =
        email && phone ? or(eq(agents.email, email), eq(agents.phone, phone)) : email ? eq(agents.email, email) : eq(agents.phone, phone!);
      const [agent] = await db.select().from(agents).where(condition);
      if (!agent) return text({ knownAgent: false });

      const history = await db
        .select({
          presetName: messagePresets.name,
          channel: messageSends.channel,
          sentAt: messageSends.sentAt,
          result: messageSends.result,
        })
        .from(messageSends)
        .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
        .where(eq(messageSends.agentId, agent.id))
        .orderBy(desc(messageSends.sentAt));

      return text({
        knownAgent: true,
        agent: {
          id: agent.id,
          name: agent.name,
          phone: agent.phone,
          email: agent.email,
          relationshipStatus: agent.relationshipStatus,
          lastContactedAt: agent.lastContactedAt,
        },
        priorSends: history,
      });
    }
  );

  server.registerTool(
    "import_agent",
    {
      title: "Import a new agent",
      description: "Creates a new agent contact. Fails if the phone or email already belongs to an existing agent.",
      inputSchema: {
        name: z.string(),
        phone: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
        relationshipStatus: z.enum(AGENT_RELATIONSHIP_STATUSES).default("cold"),
      },
    },
    async ({ name, phone, email, notes, relationshipStatus }) => {
      const parsed = normalizeContact(phone, email);
      if (parsed.error) return errorText(parsed.error);

      if (parsed.phone) {
        const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.phone, parsed.phone));
        if (existing) return errorText(`An agent with this phone already exists (id ${existing.id})`);
      }
      if (parsed.email) {
        const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.email, parsed.email));
        if (existing) return errorText(`An agent with this email already exists (id ${existing.id})`);
      }

      const [inserted] = await db
        .insert(agents)
        .values({
          name: name.trim() || null,
          phone: parsed.phone,
          email: parsed.email,
          notes: notes?.trim() || null,
          relationshipStatus,
        })
        .returning();

      return text(inserted);
    }
  );

  server.registerTool(
    "update_agent",
    {
      title: "Update an agent",
      description: "Edits an existing agent's name, phone, email, notes, or relationship status. Only provided fields change.",
      inputSchema: {
        id: z.string().uuid(),
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
        relationshipStatus: z.enum(AGENT_RELATIONSHIP_STATUSES).optional(),
      },
    },
    async ({ id, name, phone, email, notes, relationshipStatus }) => {
      const [existing] = await db.select().from(agents).where(eq(agents.id, id));
      if (!existing) return errorText("No agent with that id");

      const patch: Partial<typeof agents.$inferInsert> = {};
      if (name !== undefined) patch.name = name.trim() || null;
      if (notes !== undefined) patch.notes = notes.trim() || null;
      if (relationshipStatus !== undefined) patch.relationshipStatus = relationshipStatus as AgentRelationshipStatus;
      if (phone !== undefined || email !== undefined) {
        const parsed = normalizeContact(phone ?? existing.phone ?? undefined, email ?? existing.email ?? undefined);
        if (parsed.error) return errorText(parsed.error);
        patch.phone = parsed.phone;
        patch.email = parsed.email;
      }

      const [updated] = await db.update(agents).set(patch).where(eq(agents.id, id)).returning();
      return text(updated);
    }
  );

  server.registerTool(
    "agent_stats",
    {
      title: "Agent production stats",
      description:
        "Per-agent aggregated stats — booking count, total booking revenue, most recent booking date, listing count — for answering questions like 'who is my most producing agent' or 'who have I booked least recently'. Sorted and limited; agents with zero bookings sort as the most overdue under least_recently_booked.",
      inputSchema: {
        sortBy: z
          .enum(["most_bookings", "most_revenue", "least_recently_booked", "most_recently_booked", "most_listings"])
          .default("most_bookings"),
        onlyWithBookings: z.boolean().default(false).describe("Exclude agents with zero bookings"),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ sortBy, onlyWithBookings, limit }) => {
      const [allAgents, allBookings, allLineItems, agentListingCounts] = await Promise.all([
        db.select().from(agents),
        db.select().from(bookings),
        db.select().from(bookingLineItems),
        db
          .select({ agentPhone: listings.agentPhone })
          .from(listings)
          .where(isNotNull(listings.agentPhone)),
      ]);

      const revenueByBooking = new Map<string, number>();
      for (const li of allLineItems) revenueByBooking.set(li.bookingId, (revenueByBooking.get(li.bookingId) ?? 0) + li.amount);

      const listingCountByPhone = new Map<string, number>();
      for (const l of agentListingCounts) {
        if (l.agentPhone) listingCountByPhone.set(l.agentPhone, (listingCountByPhone.get(l.agentPhone) ?? 0) + 1);
      }

      const bookingsByAgent = new Map<string, typeof allBookings>();
      for (const b of allBookings) {
        if (!b.contactAgentId) continue;
        const arr = bookingsByAgent.get(b.contactAgentId) ?? [];
        arr.push(b);
        bookingsByAgent.set(b.contactAgentId, arr);
      }

      const stats = allAgents.map((agent) => {
        const agentBookings = bookingsByAgent.get(agent.id) ?? [];
        const totalRevenue = agentBookings.reduce((sum, b) => sum + (revenueByBooking.get(b.id) ?? 0), 0);
        const mostRecentBookingDate = agentBookings.reduce<Date | null>((latest, b) => {
          const d = b.jobDate ?? b.createdAt;
          return !latest || d > latest ? d : latest;
        }, null);
        return {
          id: agent.id,
          name: agent.name,
          phone: agent.phone,
          email: agent.email,
          relationshipStatus: agent.relationshipStatus,
          bookingCount: agentBookings.length,
          totalRevenue,
          mostRecentBookingDate,
          listingCount: agent.phone ? listingCountByPhone.get(agent.phone) ?? 0 : 0,
          lastContactedAt: agent.lastContactedAt,
        };
      });

      const filtered = onlyWithBookings ? stats.filter((s) => s.bookingCount > 0) : stats;

      const sorted = filtered.sort((a, b) => {
        switch (sortBy) {
          case "most_revenue":
            return b.totalRevenue - a.totalRevenue;
          case "most_listings":
            return b.listingCount - a.listingCount;
          case "least_recently_booked": {
            const at = a.mostRecentBookingDate?.getTime() ?? -Infinity;
            const bt = b.mostRecentBookingDate?.getTime() ?? -Infinity;
            return at - bt;
          }
          case "most_recently_booked": {
            const at = a.mostRecentBookingDate?.getTime() ?? -Infinity;
            const bt = b.mostRecentBookingDate?.getTime() ?? -Infinity;
            return bt - at;
          }
          case "most_bookings":
          default:
            return b.bookingCount - a.bookingCount;
        }
      });

      return text(sorted.slice(0, limit));
    }
  );
}
