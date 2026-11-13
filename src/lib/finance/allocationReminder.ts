/**
 * The automatic "move the money" reminder on Profit First allocation days
 * (the 10th and 25th). The wording is pure and lives next to the report so it
 * can be checked without a database; createAllocationReminder does the one
 * side effect — a reminder on the Schedule page plus a push.
 *
 * Since the report's `sinceLastAllocation` window runs from the previous
 * allocation day through yesterday on an allocation day, its numbers are
 * exactly what has come in since the last move, i.e. what to move today.
 */

import { and, eq, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { reminders } from "@/db/schema";
import { notifyProfitFirstAllocation } from "@/lib/push";
import { dayLabel, formatDollars } from "./format";
import { PF_ACCOUNTS, type ProfitFirstReport } from "./profitFirst";
import { loadProfitFirstReport } from "./profitFirstReport";

/** Push bodies have no room for "Operating expenses". */
const SHORT_LABELS: Partial<Record<string, string>> = { opex: "OpEx" };

const shortLabel = (key: string, label: string) => SHORT_LABELS[key] ?? label;

/** The reminder's title, its notes (one line per account) and the push one-liner. */
export function allocationReminderText(report: ProfitFirstReport): { title: string; notes: string; pushBody: string } {
  const period = report.sinceLastAllocation;
  const { realRevenue, collected, subcontractors, jobs, allocations } = period;

  const title =
    realRevenue === 0 ? "Profit First: nothing to move" : `Profit First: move ${formatDollars(realRevenue)}`;

  const lines = PF_ACCOUNTS.map(
    ({ key, label }) => `${label} (${report.percents[key]}%): ${formatDollars(allocations[key])}`
  );
  lines.push(
    `From ${formatDollars(collected)} collected ${dayLabel(period.start)} – ${dayLabel(period.end)} ` +
      `(${jobs} ${jobs === 1 ? "job" : "jobs"})`
  );
  // Only when subs actually came off the collected total.
  if (subcontractors > 0) lines.push(`Subcontractors: ${formatDollars(-subcontractors)}`);

  const pushBody = PF_ACCOUNTS.map(
    ({ key, label }) => `${shortLabel(key, label)} ${formatDollars(allocations[key])}`
  ).join(" · ");

  return { title, notes: lines.join("\n"), pushBody };
}

/**
 * Creates today's allocation reminder when today is the 10th or 25th, and
 * pushes it. Idempotent: a second cron run on the same day sees the reminder
 * already there and does nothing. Returns why nothing was created so the
 * cron route can say so in its response.
 */
export async function createAllocationReminder(today: string): Promise<{ created: boolean; reason?: string }> {
  const day = Number(today.slice(8));
  if (day !== 10 && day !== 25) return { created: false, reason: "not an allocation day" };

  const report = await loadProfitFirstReport();

  const [existing] = await db
    .select({ id: reminders.id })
    .from(reminders)
    .where(and(eq(reminders.date, today), ilike(reminders.title, "Profit First:%")))
    .limit(1);
  if (existing) return { created: false, reason: "already created" };

  const { title, notes, pushBody } = allocationReminderText(report);
  await db.insert(reminders).values({ title, date: today, time: "09:00", notes });
  // The reminder is the important part; a push that fails must not undo it.
  await notifyProfitFirstAllocation(title, pushBody).catch(() => {});
  revalidatePath("/schedule");
  return { created: true };
}
