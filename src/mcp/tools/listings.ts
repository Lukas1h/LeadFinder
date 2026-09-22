import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { listings, agents, bookings, LEAD_STATUSES } from "@/db/schema";
import { extractZpidFromUrl, fetchFullListing } from "@/lib/zillapi";
import { insertAndEnrichListings } from "@/lib/sync";
import { text, errorText } from "./shared";

export function registerListingTools(server: McpServer): void {
  server.registerTool(
    "search_listings",
    {
      title: "Search/filter listings",
      description:
        "Filters listings by status, location, price, photo score, coming-soon flag, and whether they have a booking. All filters are ANDed together; omit a filter to not constrain on it.",
      inputSchema: {
        status: z.enum(LEAD_STATUSES).optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        minPrice: z.number().int().optional(),
        maxPrice: z.number().int().optional(),
        minScore: z.number().int().optional(),
        maxScore: z.number().int().optional(),
        isComingSoon: z.boolean().optional(),
        hasBooking: z.boolean().optional(),
        agentQuery: z.string().optional().describe("Substring match against the listing's agent name or phone"),
        sortBy: z.enum(["newest", "oldest", "price_desc", "price_asc", "score_asc", "score_desc"]).default("newest"),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ status, city, state, minPrice, maxPrice, minScore, maxScore, isComingSoon, hasBooking, agentQuery, sortBy, limit }) => {
      const conditions = [];
      if (status) conditions.push(eq(listings.status, status));
      if (city) conditions.push(eq(listings.city, city));
      if (state) conditions.push(eq(listings.state, state));
      if (minPrice != null) conditions.push(gte(listings.price, minPrice));
      if (maxPrice != null) conditions.push(lte(listings.price, maxPrice));
      if (minScore != null) conditions.push(gte(listings.score, minScore));
      if (maxScore != null) conditions.push(lte(listings.score, maxScore));
      if (isComingSoon != null) conditions.push(eq(listings.isComingSoon, isComingSoon));

      let rows = await db
        .select()
        .from(listings)
        .where(conditions.length ? and(...conditions) : undefined);

      if (hasBooking === true) rows = rows.filter((l) => l.bookingId != null);
      if (hasBooking === false) rows = rows.filter((l) => l.bookingId == null);
      if (agentQuery) {
        const q = agentQuery.toLowerCase();
        rows = rows.filter((l) => l.agentName?.toLowerCase().includes(q) || l.agentPhone?.toLowerCase().includes(q));
      }

      const sorted = [...rows].sort((a, b) => {
        switch (sortBy) {
          case "oldest":
            return a.foundAt.getTime() - b.foundAt.getTime();
          case "price_desc":
            return (b.price ?? -Infinity) - (a.price ?? -Infinity);
          case "price_asc":
            return (a.price ?? Infinity) - (b.price ?? Infinity);
          case "score_asc":
            return (a.score ?? Infinity) - (b.score ?? Infinity);
          case "score_desc":
            return (b.score ?? -Infinity) - (a.score ?? -Infinity);
          case "newest":
          default:
            return b.foundAt.getTime() - a.foundAt.getTime();
        }
      });

      return text(sorted.slice(0, limit));
    }
  );

  server.registerTool(
    "get_listing",
    {
      title: "Get listing detail",
      description: "Full detail for one listing by id, including its agent (if known) and linked booking (if any).",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const [listing] = await db.select().from(listings).where(eq(listings.id, id));
      if (!listing) return errorText("No listing with that id");

      const [agent] = listing.agentId ? await db.select().from(agents).where(eq(agents.id, listing.agentId)) : [];
      const [booking] = listing.bookingId ? await db.select().from(bookings).where(eq(bookings.id, listing.bookingId)) : [];

      return text({ listing, agent: agent ?? null, booking: booking ?? null });
    }
  );

  server.registerTool(
    "update_listing",
    {
      title: "Update a listing",
      description:
        "Edits a listing's status, notes, or follow-up date/note. Only provided fields change. This is a direct field patch — it does NOT run the app's booking/status side effects (use create_booking to actually book a listing, which also flips its status correctly).",
      inputSchema: {
        id: z.string().uuid(),
        status: z.enum(LEAD_STATUSES).optional(),
        notes: z.string().optional(),
        followUpAt: z.string().datetime().nullable().optional().describe("ISO datetime, or null to clear"),
        followUpNote: z.string().optional(),
      },
    },
    async ({ id, status, notes, followUpAt, followUpNote }) => {
      const [existing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.id, id));
      if (!existing) return errorText("No listing with that id");

      const patch: Partial<typeof listings.$inferInsert> = {};
      if (status !== undefined) {
        patch.status = status;
        patch.statusChangedAt = new Date();
      }
      if (notes !== undefined) patch.notes = notes.trim() || null;
      if (followUpAt !== undefined) patch.followUpAt = followUpAt ? new Date(followUpAt) : null;
      if (followUpNote !== undefined) patch.followUpNote = followUpNote.trim() || null;

      const [updated] = await db.update(listings).set(patch).where(eq(listings.id, id)).returning();
      return text(updated);
    }
  );

  server.registerTool(
    "import_listing",
    {
      title: "Import a listing from a Zillow URL",
      description:
        "Fetches full listing details (price, photos, agent, an AI photo-quality score) from a Zillow URL and inserts it with status 'saved'. No-ops with alreadyImported: true if this listing (by zpid) is already in the database. Can take several seconds (photo scoring).",
      inputSchema: { url: z.string().url() },
    },
    async ({ url }) => {
      const zpid = extractZpidFromUrl(url);
      if (!zpid) return errorText("That doesn't look like a Zillow listing URL");

      const [existing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.zpid, zpid));
      if (existing) return text({ alreadyImported: true, listingId: existing.id });

      const full = await fetchFullListing(zpid);
      if (!full) return errorText("Couldn't fetch that listing from Zillow — it may be off-market or the URL is stale");

      const inserted = await insertAndEnrichListings([{ ...full, sourceLabel: "MCP import", status: "saved" }], {
        notificationUrl: "/pipeline",
      });
      if (inserted === 0) return errorText("Listing was not inserted (likely a duplicate zpid race) — try again");

      const [row] = await db.select().from(listings).where(eq(listings.zpid, zpid));
      return text({ imported: true, listing: row });
    }
  );
}
