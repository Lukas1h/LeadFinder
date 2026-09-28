// Reminder input rules, shared by the Schedule page's server actions
// (src/app/schedule/actions.ts) and the reminder MCP tools
// (src/mcp/tools/schedule.ts). Plain module, not "use server", so the MCP
// side can use it without importing an action file (see src/mcp/tools.ts).

export interface ReminderInput {
  title: string;
  date: string; // "YYYY-MM-DD", Pacific calendar day
  time: string | null; // "HH:MM" 24h, null = all day
  durationMinutes: number | null;
  notes: string | null;
  agentId: string | null;
}

export const REMINDER_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const REMINDER_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateReminderInput(input: ReminderInput): { error: string } | { values: ReminderInput } {
  const title = input.title.trim();
  if (!title) return { error: "Give it a title" };
  if (!REMINDER_DATE_RE.test(input.date) || Number.isNaN(new Date(`${input.date}T12:00:00Z`).getTime())) {
    return { error: "Pick a date" };
  }
  if (input.time != null && !REMINDER_TIME_RE.test(input.time)) return { error: "Time must look like 14:30" };
  const durationMinutes =
    input.time != null && input.durationMinutes != null && input.durationMinutes > 0
      ? Math.round(input.durationMinutes)
      : null;
  return {
    values: {
      title,
      date: input.date,
      time: input.time,
      // A length only means something with a start time.
      durationMinutes,
      notes: input.notes?.trim() || null,
      agentId: input.agentId,
    },
  };
}
