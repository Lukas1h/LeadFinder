import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings, bookingLineItems, listings, agents, type NewBookingLineItem } from "@/db/schema";
import { estimateDriveTime } from "@/lib/driveTime";
import { normalizePhone, normalizeName } from "@/lib/normalize";
import { attributeBookingToSend } from "@/lib/agentIdentity";
import { text, errorText } from "./shared";

async function joinedBooking(bookingId: string) {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) return null;

  const [linkedListing, contact, lineItems] = await Promise.all([
    booking.listingId ? db.select().from(listings).where(eq(listings.id, booking.listingId)).then((r) => r[0] ?? null) : null,
    booking.contactAgentId
      ? db.select().from(agents).where(eq(agents.id, booking.contactAgentId)).then((r) => r[0] ?? null)
      : null,
    db.select().from(bookingLineItems).where(eq(bookingLineItems.bookingId, bookingId)),
  ]);

  const city = linkedListing?.city ?? booking.city;
  const total = lineItems.reduce((sum, li) => sum + li.amount, 0);

  return {
    ...booking,
    address: linkedListing?.address ?? booking.address,
    city,
    state: linkedListing?.state ?? booking.state,
    listing: linkedListing,
    contact,
    lineItems,
    total,
    driveTime: city ? estimateDriveTime(city) : null,
  };
}

/** Same lazy find-or-create-by-phone pattern used elsewhere (findOrCreateAgentByPhone in booked/actions.ts, touchAgentContact in actions.ts). */
async function findOrCreateAgentByPhone(phone: string, name: string): Promise<string | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.phone, normalizedPhone));
  if (existing) return existing.id;

  const [row] = await db
    .insert(agents)
    .values({ phone: normalizedPhone, name: name.trim() ? normalizeName(name) : null })
    .returning({ id: agents.id });
  return row?.id ?? null;
}

const lineItemSchema = z.object({ description: z.string(), amount: z.number().int().positive() });

export function registerBookingTools(server: McpServer): void {
  server.registerTool(
    "search_bookings",
    {
      title: "Search/filter bookings",
      description: "Filters bookings by completion status, city, and job-date range. Sorted by job date.",
      inputSchema: {
        completed: z.boolean().optional().describe("true = only completed, false = only upcoming/active"),
        city: z.string().optional(),
        fromDate: z.string().datetime().optional().describe("ISO datetime — only bookings with jobDate on/after this"),
        toDate: z.string().datetime().optional().describe("ISO datetime — only bookings with jobDate on/before this"),
        sortBy: z.enum(["job_date_asc", "job_date_desc", "newest"]).default("job_date_asc"),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ completed, city, fromDate, toDate, sortBy, limit }) => {
      let rows = await db.select().from(bookings);

      if (completed === true) rows = rows.filter((b) => b.completedAt != null);
      if (completed === false) rows = rows.filter((b) => b.completedAt == null);
      if (city) rows = rows.filter((b) => b.city === city);
      if (fromDate) {
        const from = new Date(fromDate).getTime();
        rows = rows.filter((b) => b.jobDate != null && b.jobDate.getTime() >= from);
      }
      if (toDate) {
        const to = new Date(toDate).getTime();
        rows = rows.filter((b) => b.jobDate != null && b.jobDate.getTime() <= to);
      }

      const sorted = [...rows].sort((a, b) => {
        switch (sortBy) {
          case "job_date_desc":
            return (b.jobDate?.getTime() ?? -Infinity) - (a.jobDate?.getTime() ?? -Infinity);
          case "newest":
            return b.createdAt.getTime() - a.createdAt.getTime();
          case "job_date_asc":
          default:
            return (a.jobDate?.getTime() ?? Infinity) - (b.jobDate?.getTime() ?? Infinity);
        }
      });

      return text(sorted.slice(0, limit));
    }
  );

  server.registerTool(
    "get_booking",
    {
      title: "Get booking detail",
      description: "Full detail for one booking — line items with total, linked listing (if any), and contact agent (if any).",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const joined = await joinedBooking(id);
      if (!joined) return errorText("No booking with that id");
      return text(joined);
    }
  );

  server.registerTool(
    "create_booking",
    {
      title: "Create a booking",
      description:
        "Books a job — either tied to an existing listing (pass listingId, which also flips that listing's status to 'booked') or a standalone booking with no listing (pass address/city/state instead). The contact is looked up or created by phone. " +
        "Note: unlike the app's own booking form, this does not bump the agent's relationship status or resolve message-send outcomes — those are cosmetic and can be set separately via update_agent if needed.",
      inputSchema: {
        listingId: z.string().uuid().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        contactName: z.string().default(""),
        contactPhone: z.string().default(""),
        jobDate: z.string().datetime().optional(),
        lockboxCode: z.string().optional(),
        notes: z.string().optional(),
        lineItems: z.array(lineItemSchema).default([]),
      },
    },
    async ({ listingId, address, city, state, contactName, contactPhone, jobDate, lockboxCode, notes, lineItems }) => {
      if (!listingId && !city?.trim()) return errorText("Enter at least a city for a booking with no linked listing");

      const contactAgentId =
        contactName.trim() || contactPhone.trim() ? await findOrCreateAgentByPhone(contactPhone, contactName) : null;

      const [booking] = await db
        .insert(bookings)
        .values({
          listingId: listingId ?? null,
          address: listingId ? null : address?.trim() || null,
          city: listingId ? null : city?.trim() || null,
          state: listingId ? null : state?.trim() || null,
          contactAgentId,
          jobDate: jobDate ? new Date(jobDate) : null,
          lockboxCode: lockboxCode?.trim() || null,
          notes: notes?.trim() || null,
        })
        .returning({ id: bookings.id });
      if (!booking) return errorText("Couldn't create the booking");

      // Credit the outreach that won the job — see attributeBookingToSend.
      await attributeBookingToSend(booking.id, contactAgentId, jobDate ? new Date(jobDate) : new Date());

      const validLineItems: NewBookingLineItem[] = lineItems
        .filter((li) => li.description.trim())
        .map((li) => ({ bookingId: booking.id, description: li.description.trim(), amount: li.amount }));
      if (validLineItems.length > 0) await db.insert(bookingLineItems).values(validLineItems);

      if (listingId) {
        await db
          .update(listings)
          .set({ status: "booked", statusChangedAt: new Date(), bookingId: booking.id })
          .where(eq(listings.id, listingId));
      }

      const joined = await joinedBooking(booking.id);
      return text(joined);
    }
  );

  server.registerTool(
    "update_booking",
    {
      title: "Update a booking",
      description:
        "Edits an existing booking's contact, job date, lockbox code, notes, or line items. Passing lineItems replaces the full set (not a merge/diff) — omit it to leave line items untouched.",
      inputSchema: {
        id: z.string().uuid(),
        contactName: z.string().optional(),
        contactPhone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        jobDate: z.string().datetime().nullable().optional(),
        lockboxCode: z.string().optional(),
        notes: z.string().optional(),
        lineItems: z.array(lineItemSchema).optional(),
      },
    },
    async ({ id, contactName, contactPhone, address, city, state, jobDate, lockboxCode, notes, lineItems }) => {
      const [existing] = await db.select().from(bookings).where(eq(bookings.id, id));
      if (!existing) return errorText("No booking with that id");

      const patch: Partial<typeof bookings.$inferInsert> = {};
      if (address !== undefined) patch.address = address.trim() || null;
      if (city !== undefined) patch.city = city.trim() || null;
      if (state !== undefined) patch.state = state.trim() || null;
      if (jobDate !== undefined) patch.jobDate = jobDate ? new Date(jobDate) : null;
      if (lockboxCode !== undefined) patch.lockboxCode = lockboxCode.trim() || null;
      if (notes !== undefined) patch.notes = notes.trim() || null;
      if (contactName !== undefined || contactPhone !== undefined) {
        const name = contactName ?? "";
        const phone = contactPhone ?? "";
        patch.contactAgentId = name.trim() || phone.trim() ? await findOrCreateAgentByPhone(phone, name) : null;
      }

      if (Object.keys(patch).length > 0) {
        await db.update(bookings).set(patch).where(eq(bookings.id, id));
      }

      if (lineItems !== undefined) {
        await db.delete(bookingLineItems).where(eq(bookingLineItems.bookingId, id));
        const validLineItems: NewBookingLineItem[] = lineItems
          .filter((li) => li.description.trim())
          .map((li) => ({ bookingId: id, description: li.description.trim(), amount: li.amount }));
        if (validLineItems.length > 0) await db.insert(bookingLineItems).values(validLineItems);
      }

      const joined = await joinedBooking(id);
      return text(joined);
    }
  );

  server.registerTool(
    "complete_booking",
    {
      title: "Mark a booking completed",
      description: "Sets completedAt to now.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const [updated] = await db.update(bookings).set({ completedAt: new Date() }).where(eq(bookings.id, id)).returning();
      if (!updated) return errorText("No booking with that id");
      return text(updated);
    }
  );

  server.registerTool(
    "reopen_booking",
    {
      title: "Reopen a completed booking",
      description: "Clears completedAt, moving it back to upcoming/active.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const [updated] = await db.update(bookings).set({ completedAt: null }).where(eq(bookings.id, id)).returning();
      if (!updated) return errorText("No booking with that id");
      return text(updated);
    }
  );
}
