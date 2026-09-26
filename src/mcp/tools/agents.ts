import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  listings,
  bookings,
  bookingLineItems,
  messagePresets,
  messageSends,
  agentInteractions,
  AGENT_RELATIONSHIP_STATUSES,
  type AgentRelationshipStatus,
} from "@/db/schema";
import { resolveAvgDaysBetweenListings } from "@/app/agents/stats";
import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/normalize";
import { text, errorText, normalizeContact } from "./shared";
import { setAgentRelationshipStatus } from "@/lib/agentIdentity";

export function registerAgentTools(server: McpServer): void {
  server.registerTool(
    "search_agents",
    {
      title: "Search agents",
      description:
        "Search LeadFinder's agent/realtor contacts by name/phone/email substring, relationship status, and contact-info presence. Returns up to `limit` matches, newest first by default. Each result includes avgListingsPerYear/avgListingPrice (manually researched, null if not entered) and avgDaysBetweenListings (computed from our own tracked listings, null below 3 of them).",
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

      const page = sorted.slice(0, limit);
      const ids = page.map((a) => a.id);
      const pageListings = ids.length
        ? await db
            .select({ agentId: listings.agentId, listedAt: listings.listedAt, foundAt: listings.foundAt })
            .from(listings)
            .where(inArray(listings.agentId, ids))
        : [];
      const listingsByAgent = new Map<string, typeof pageListings>();
      for (const l of pageListings) {
        if (!l.agentId) continue;
        (listingsByAgent.get(l.agentId) ?? listingsByAgent.set(l.agentId, []).get(l.agentId)!).push(l);
      }

      return text(
        page.map((a) => ({
          ...a,
          avgDaysBetweenListings: resolveAvgDaysBetweenListings(a, listingsByAgent.get(a.id) ?? []),
        }))
      );
    }
  );

  server.registerTool(
    "get_agent",
    {
      title: "Get agent detail",
      description:
        "Full detail for one agent by id, phone, or email — the agent row (including the researched avgListingsPerYear/avgListingPrice stats), their listings, avgDaysBetweenListings (researched value if set, otherwise computed from tracked listings and null below 3 of them), their templated send history, every logged interaction (calls, texts and emails that happened outside the app, in both directions), and their bookings. Exactly one of id/phone/email must be given.",
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

      const agentListings = await db.select().from(listings).where(eq(listings.agentId, agent.id));

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

      // Sends and interactions are separate tables on purpose (see the comment
      // on agentInteractions in schema.ts) but they're one story, so both come
      // back here rather than making a caller know to ask twice.
      const interactions = await db
        .select({
          id: agentInteractions.id,
          occurredAt: agentInteractions.occurredAt,
          channel: agentInteractions.channel,
          direction: agentInteractions.direction,
          outcome: agentInteractions.outcome,
          note: agentInteractions.note,
          unconfirmed: isNotNull(agentInteractions.pendingSince),
          source: agentInteractions.source,
        })
        .from(agentInteractions)
        .where(eq(agentInteractions.agentId, agent.id))
        .orderBy(desc(agentInteractions.occurredAt));

      return text({
        agent,
        avgDaysBetweenListings: resolveAvgDaysBetweenListings(agent, agentListings),
        listings: agentListings,
        sendHistory: history,
        interactions,
        bookings: agentBookings,
      });
    }
  );

  server.registerTool(
    "check_contact_history",
    {
      title: "Check whether an agent has already been contacted",
      description:
        "Given an email, phone, and/or name, reports whether this person is already a known agent and, if so, when they were last contacted, their send history, and every logged interaction (calls, texts and emails outside the app) — use this BEFORE send_agent_email to decide whether a duplicate-send warning is worth surfacing to the user. Pass the name too whenever you have it: a contact first added from a cold-email list has an email and no phone, while one picked up from a listing has a phone and no email, so checking only the identifier in front of you can report 'never contacted' about someone mid-conversation. Each priorSends row separates two things: respondedAt is when they FIRST replied, stamped automatically the instant an inbound interaction is logged, and result is the commercial outcome (pending/quoted/booked/declined). Judge whether someone answered by respondedAt, never by result — result \"pending\" only means no quote, booking or decline has been recorded yet, so an agent who replied and is still talking is correctly respondedAt-set with result \"pending\", and that is not a stat that needs correcting.",
      inputSchema: {
        email: z.string().optional(),
        phone: z.string().optional(),
        name: z.string().optional(),
      },
    },
    async ({ email, phone, name }) => {
      if (!email && !phone && !name) return errorText("Provide an email, phone, or name");

      const identifiers = [
        email ? eq(agents.email, normalizeEmail(email)) : null,
        phone ? eq(agents.phone, normalizePhone(phone)) : null,
      ].filter((c) => c !== null);

      let agent = identifiers.length
        ? (await db.select().from(agents).where(identifiers.length > 1 ? or(...identifiers) : identifiers[0]))[0]
        : undefined;

      // Name is a fallback, never an override: an exact identifier match is
      // always the right answer, and a name that hits more than one row is
      // ambiguous (two realtors can share a name in one market) so it reports
      // nothing rather than guessing at the wrong person's history.
      if (!agent && name?.trim()) {
        const byName = await db
          .select()
          .from(agents)
          .where(eq(sql`lower(trim(${agents.name}))`, normalizeName(name).trim().toLowerCase()));
        if (byName.length === 1) agent = byName[0];
      }

      if (!agent) return text({ knownAgent: false });

      // respondedAt rides along because result alone reads as a false alarm:
      // "pending" here means no *commercial* outcome recorded yet, not that the
      // agent never wrote back. An agent who replied and is still negotiating
      // is legitimately respondedAt-set + result "pending", and a caller seeing
      // only "pending" will conclude the reply was never recorded and go looking
      // for a way to "fix" a stat that is already correct.
      const history = await db
        .select({
          presetName: messagePresets.name,
          channel: messageSends.channel,
          sentAt: messageSends.sentAt,
          respondedAt: messageSends.respondedAt,
          result: messageSends.result,
        })
        .from(messageSends)
        .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
        .where(eq(messageSends.agentId, agent.id))
        .orderBy(desc(messageSends.sentAt));

      // A phone call or a text they sent counts as prior contact every bit as
      // much as a templated send does, and reporting only sends here would
      // answer "have I talked to this person" with a confident half-truth.
      const priorInteractions = await db
        .select({
          occurredAt: agentInteractions.occurredAt,
          channel: agentInteractions.channel,
          direction: agentInteractions.direction,
          outcome: agentInteractions.outcome,
          note: agentInteractions.note,
        })
        .from(agentInteractions)
        .where(eq(agentInteractions.agentId, agent.id))
        .orderBy(desc(agentInteractions.occurredAt));

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
        priorInteractions,
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
          name: name.trim() ? normalizeName(name) : null,
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
      description:
        "Edits an existing agent's name, phone, email, notes, relationship status, or researched production stats. Only provided fields change; pass null to a stat to clear it. " +
        "The three stats are all figures looked up from outside our own data (a public profile, MLS history) rather than anything the app observes. avgDaysBetweenListings in particular overrides a number normally computed from our tracked listings, which is null below 3 of them — set it when you've researched an agent's real cadence and our sample is too thin to show one.",
      inputSchema: {
        id: z.string().uuid(),
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
        relationshipStatus: z.enum(AGENT_RELATIONSHIP_STATUSES).optional(),
        avgListingsPerYear: z.number().int().min(0).nullable().optional().describe("Listings this agent takes in a typical year"),
        avgListingPrice: z.number().int().min(0).nullable().optional().describe("Their typical listing price, whole dollars"),
        avgDaysBetweenListings: z
          .number()
          .int()
          .min(0)
          .nullable()
          .optional()
          .describe("Researched days between their listings; overrides the value computed from our own tracked listings"),
      },
    },
    async ({ id, name, phone, email, notes, relationshipStatus, avgListingsPerYear, avgListingPrice, avgDaysBetweenListings }) => {
      const [existing] = await db.select().from(agents).where(eq(agents.id, id));
      if (!existing) return errorText("No agent with that id");

      const patch: Partial<typeof agents.$inferInsert> = {};
      if (name !== undefined) patch.name = name.trim() ? normalizeName(name) : null;
      if (notes !== undefined) patch.notes = notes.trim() || null;
      if (avgListingsPerYear !== undefined) patch.avgListingsPerYear = avgListingsPerYear;
      if (avgListingPrice !== undefined) patch.avgListingPrice = avgListingPrice;
      if (avgDaysBetweenListings !== undefined) patch.avgDaysBetweenListings = avgDaysBetweenListings;
      if (phone !== undefined || email !== undefined) {
        const parsed = normalizeContact(phone ?? existing.phone ?? undefined, email ?? existing.email ?? undefined);
        if (parsed.error) return errorText(parsed.error);
        patch.phone = parsed.phone;
        patch.email = parsed.email;
      }

      // Drizzle rejects an empty set() outright, so a call that named only the
      // id is answered with the row as-is rather than an error.
      if (Object.keys(patch).length === 0 && relationshipStatus === undefined) return text(existing);

      // Applied after the patch rather than inside it, so the declinedAt
      // bookkeeping lives in exactly one place. Setting relationshipStatus here
      // directly is what let an agent be marked declined with no declinedAt —
      // invisible to declinedOnly and to the 30-day resurface.
      if (Object.keys(patch).length > 0) {
        await db.update(agents).set(patch).where(eq(agents.id, id));
      }
      if (relationshipStatus !== undefined) {
        await setAgentRelationshipStatus(id, relationshipStatus as AgentRelationshipStatus);
      }

      const [updated] = await db.select().from(agents).where(eq(agents.id, id));
      return text(updated);
    }
  );

  server.registerTool(
    "agent_stats",
    {
      title: "Agent production stats",
      description:
        "Per-agent aggregated stats — booking count, total booking revenue, most recent booking date, listing count, avgDaysBetweenListings (computed from our own tracked listings, null below 3 of them), and avgListingsPerYear/avgListingPrice (manually researched, null if not entered) — for answering questions like 'who is my most producing agent', 'who have I booked least recently', or 'which agents list frequently'. Sorted and limited; agents with zero bookings sort as the most overdue under least_recently_booked.",
      inputSchema: {
        sortBy: z
          .enum(["most_bookings", "most_revenue", "least_recently_booked", "most_recently_booked", "most_listings"])
          .default("most_bookings"),
        onlyWithBookings: z.boolean().default(false).describe("Exclude agents with zero bookings"),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ sortBy, onlyWithBookings, limit }) => {
      const [allAgents, allBookings, allLineItems, agentListingDates] = await Promise.all([
        // Only the columns this tool actually returns — not notes/
        // realtorProfileUrl/declinedAt/createdAt/lastContactedListingId.
        // This full-agents-table fetch runs unconditionally on every call
        // with no filter to shrink it, so trimming columns matters a lot
        // more here than on a filtered query — it was the single largest
        // contributor to a real Neon data-transfer overage (repeated calls,
        // ~4,700 agent rows' worth of unused columns each time).
        db
          .select({
            id: agents.id,
            name: agents.name,
            phone: agents.phone,
            email: agents.email,
            relationshipStatus: agents.relationshipStatus,
            avgListingsPerYear: agents.avgListingsPerYear,
            avgListingPrice: agents.avgListingPrice,
            avgDaysBetweenListings: agents.avgDaysBetweenListings,
            lastContactedAt: agents.lastContactedAt,
          })
          .from(agents),
        db.select().from(bookings),
        db.select().from(bookingLineItems),
        db
          .select({ agentId: listings.agentId, listedAt: listings.listedAt, foundAt: listings.foundAt })
          .from(listings)
          .where(isNotNull(listings.agentId)),
      ]);

      const revenueByBooking = new Map<string, number>();
      for (const li of allLineItems) revenueByBooking.set(li.bookingId, (revenueByBooking.get(li.bookingId) ?? 0) + li.amount);

      const listingsByAgentId = new Map<string, typeof agentListingDates>();
      for (const l of agentListingDates) {
        if (!l.agentId) continue;
        (listingsByAgentId.get(l.agentId) ?? listingsByAgentId.set(l.agentId, []).get(l.agentId)!).push(l);
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
        const agentListings = listingsByAgentId.get(agent.id) ?? [];
        return {
          id: agent.id,
          name: agent.name,
          phone: agent.phone,
          email: agent.email,
          relationshipStatus: agent.relationshipStatus,
          bookingCount: agentBookings.length,
          totalRevenue,
          mostRecentBookingDate,
          listingCount: agentListings.length,
          avgDaysBetweenListings: resolveAvgDaysBetweenListings(agent, agentListings),
          avgListingsPerYear: agent.avgListingsPerYear,
          avgListingPrice: agent.avgListingPrice,
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
