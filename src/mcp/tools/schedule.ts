import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, reminders } from "@/db/schema";
import { addDays, todayScheduleDate, type ScheduleItem } from "@/lib/schedule";
import { loadScheduleItems } from "@/lib/scheduleItems";
import { validateReminderInput, REMINDER_DATE_RE, REMINDER_TIME_RE } from "@/lib/reminders";
import { text, errorText } from "./shared";

const DATE_DESCRIPTION =
  'Calendar day in Lukas\'s timezone (America/Los_Angeles), "YYYY-MM-DD" — not a timestamp, so no UTC offset to worry about. "Tuesday" means the coming Tuesday\'s date.';
const TIME_DESCRIPTION = '24-hour wall-clock time in Lukas\'s timezone, "HH:MM" (e.g. "14:30"). Omit/null for an all-day reminder.';

// The page's items carry the full listing row for its ListingModal — far too
// much for a tool response, and listingId already identifies it.
function forTool({ listing, ...item }: ScheduleItem) {
  return { ...item, listingAddress: listing?.address ?? null };
}

async function agentExists(id: string): Promise<boolean> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, id));
  return !!row;
}

export function registerScheduleTools(server: McpServer): void {
  server.registerTool(
    "get_schedule",
    {
      title: "Get schedule",
      description:
        "What's on Lukas's Schedule page, sorted by day then time (all-day items first): his reminders, bookings (by Pacific job date/time), and listing follow-ups (listings.followUpAt). " +
        "Each item has kind ('reminder' | 'booking' | 'followUp'), date, time (null = all day), durationMinutes, title, notes, agent {id, name, phone}, done, reminderId (reminders) and listingId (follow-ups). " +
        "Overdue items (open reminders and follow-ups dated before today) are returned separately. Bookings before today aren't included — use search_bookings for history. " +
        "To dismiss or move a follow-up, use update_listing with followUpAt (null clears it).",
      inputSchema: {
        fromDate: z.string().regex(REMINDER_DATE_RE).optional().describe(`First day to include (default today). ${DATE_DESCRIPTION}`),
        toDate: z.string().regex(REMINDER_DATE_RE).optional().describe("Last day to include, inclusive (default 30 days after fromDate)."),
        kinds: z.array(z.enum(["reminder", "booking", "followUp"])).optional().describe("Only these kinds (default all)."),
        includeDone: z.boolean().default(false).describe("Include reminders already checked off."),
      },
    },
    async ({ fromDate, toDate, kinds, includeDone }) => {
      const today = todayScheduleDate();
      const from = fromDate ?? today;
      const to = toDate ?? addDays(from, 30);
      if (to < from) return errorText("toDate is before fromDate");

      const all = (await loadScheduleItems(today)).filter(
        (item) => (!kinds || kinds.includes(item.kind)) && (includeDone || !item.done)
      );

      return text({
        today,
        overdue: all.filter((item) => item.date < today).map(forTool),
        items: all.filter((item) => item.date >= from && item.date <= to).map(forTool),
      });
    }
  );

  server.registerTool(
    "create_reminder",
    {
      title: "Add a reminder",
      description:
        "Adds a reminder to Lukas's Schedule page — something to do on a given day, e.g. an agent replied 'call me Tuesday'. " +
        "Link the agent (agentId, from search_agents) so their phone shows on the reminder with a tap-to-call link. " +
        "This only records a reminder for Lukas — it never contacts anyone.",
      inputSchema: {
        title: z.string().min(1).describe('Short action, e.g. "Call Sarah about 12 Oak St"'),
        date: z.string().regex(REMINDER_DATE_RE).describe(DATE_DESCRIPTION),
        time: z.string().regex(REMINDER_TIME_RE).nullable().optional().describe(TIME_DESCRIPTION),
        durationMinutes: z.number().int().positive().nullable().optional().describe("Length in minutes; only kept when a time is set."),
        notes: z.string().nullable().optional(),
        agentId: z.string().uuid().nullable().optional(),
      },
    },
    async ({ title, date, time, durationMinutes, notes, agentId }) => {
      if (agentId && !(await agentExists(agentId))) return errorText("No agent with that id");
      const result = validateReminderInput({
        title,
        date,
        time: time ?? null,
        durationMinutes: durationMinutes ?? null,
        notes: notes ?? null,
        agentId: agentId ?? null,
      });
      if ("error" in result) return errorText(result.error);

      const [row] = await db.insert(reminders).values(result.values).returning();
      return text(row);
    }
  );

  server.registerTool(
    "update_reminder",
    {
      title: "Update a reminder",
      description:
        "Changes a reminder's fields. Only the fields you pass change; pass null to clear time, durationMinutes, notes or agentId (clearing time also clears the length).",
      inputSchema: {
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        date: z.string().regex(REMINDER_DATE_RE).optional().describe(DATE_DESCRIPTION),
        time: z.string().regex(REMINDER_TIME_RE).nullable().optional().describe(TIME_DESCRIPTION),
        durationMinutes: z.number().int().positive().nullable().optional(),
        notes: z.string().nullable().optional(),
        agentId: z.string().uuid().nullable().optional(),
      },
    },
    async ({ id, ...patch }) => {
      const [existing] = await db.select().from(reminders).where(eq(reminders.id, id));
      if (!existing) return errorText("No reminder with that id");
      if (patch.agentId && !(await agentExists(patch.agentId))) return errorText("No agent with that id");

      const result = validateReminderInput({
        title: patch.title ?? existing.title,
        date: patch.date ?? existing.date,
        time: patch.time !== undefined ? patch.time : existing.time,
        durationMinutes: patch.durationMinutes !== undefined ? patch.durationMinutes : existing.durationMinutes,
        notes: patch.notes !== undefined ? patch.notes : existing.notes,
        agentId: patch.agentId !== undefined ? patch.agentId : existing.agentId,
      });
      if ("error" in result) return errorText(result.error);

      const [row] = await db.update(reminders).set(result.values).where(eq(reminders.id, id)).returning();
      return text(row);
    }
  );

  server.registerTool(
    "complete_reminder",
    {
      title: "Check off a reminder",
      description: "Marks a reminder done (or not done again with done: false), same as its checkbox on the Schedule page.",
      inputSchema: {
        id: z.string().uuid(),
        done: z.boolean().default(true),
      },
    },
    async ({ id, done }) => {
      const [row] = await db
        .update(reminders)
        .set({ completedAt: done ? new Date() : null })
        .where(eq(reminders.id, id))
        .returning();
      if (!row) return errorText("No reminder with that id");
      return text(row);
    }
  );

  server.registerTool(
    "delete_reminder",
    {
      title: "Delete a reminder",
      description: "Permanently removes a reminder. To just mark it done, use complete_reminder instead.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const [row] = await db.delete(reminders).where(eq(reminders.id, id)).returning({ id: reminders.id });
      if (!row) return errorText("No reminder with that id");
      return text({ deleted: row.id });
    }
  );
}
