// Shared by the Schedule page (server, builds the items) and its client
// components (group + render them). Dates here are "YYYY-MM-DD" and times
// "HH:MM" (24h) wall-clock strings in Lukas's timezone, never Date objects:
// the page renders on a UTC server and hydrates on a Pacific phone, so
// anything derived from a Date's local fields would disagree between the two.

export const SCHEDULE_TIMEZONE = "America/Los_Angeles";

export type ScheduleItemKind = "reminder" | "booking" | "followUp";

export interface ScheduleAgent {
  // Null when a listing only carries the agent's name/phone snapshot and was
  // never linked to an agents row.
  id: string | null;
  name: string | null;
  phone: string | null;
}

export interface ScheduleItem {
  key: string;
  kind: ScheduleItemKind;
  date: string;
  time: string | null;
  durationMinutes: number | null;
  title: string;
  subtitle: string | null;
  notes: string | null;
  agent: ScheduleAgent | null;
  // Where tapping a booking/follow-up goes; reminders open their edit dialog.
  href: string | null;
  // Only reminders can be checked off here.
  done: boolean;
  reminderId: string | null;
}

/** An instant's calendar day and time in Lukas's timezone. */
export function toScheduleDateTime(instant: Date): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: SCHEDULE_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** An instant `hours` ago — a helper (like isDue in lib/format.ts) so server
 * components can use it without tripping the react-hooks purity lint. */
export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export function todayScheduleDate(): string {
  return toScheduleDateTime(new Date()).date;
}

/** "2026-09-30" -> the date one day later, "2026-10-01". */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Today", "Tomorrow", or e.g. "Tue, Sep 30" (with the year if it isn't `today`'s). */
export function formatScheduleDay(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

function formatClock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "All day", "2:30 PM", or "2:30 PM – 3:00 PM" when there's a length. */
export function formatScheduleTime(time: string | null, durationMinutes: number | null): string {
  if (!time) return "All day";
  if (!durationMinutes) return formatClock(time);
  const [h, m] = time.split(":").map(Number);
  const end = h * 60 + m + durationMinutes;
  const endTime = `${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  return `${formatClock(time)} – ${formatClock(endTime)}`;
}

/** 30 -> "30 min", 90 -> "1 hr 30 min", 120 -> "2 hr". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** All-day items first, then by time; ties keep a stable order by key. */
export function compareScheduleItems(a: ScheduleItem, b: ScheduleItem): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (!a.time !== !b.time) return a.time ? 1 : -1;
  if (a.time && b.time && a.time !== b.time) return a.time.localeCompare(b.time);
  return a.key.localeCompare(b.key);
}
