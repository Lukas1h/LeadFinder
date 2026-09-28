"use server";

import { db } from "@/db";
import { listings, reminders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export interface ReminderInput {
  title: string;
  date: string; // "YYYY-MM-DD"
  time: string | null; // "HH:MM" 24h, null = all day
  durationMinutes: number | null;
  notes: string | null;
  agentId: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validate(input: ReminderInput): { error: string } | { values: ReminderInput } {
  const title = input.title.trim();
  if (!title) return { error: "Give it a title" };
  if (!DATE_RE.test(input.date)) return { error: "Pick a date" };
  if (input.time != null && !TIME_RE.test(input.time)) return { error: "Time must look like 14:30" };
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

function revalidate() {
  revalidatePath("/schedule");
}

export async function createReminder(input: ReminderInput): Promise<{ error: string | null }> {
  const result = validate(input);
  if ("error" in result) return result;
  await db.insert(reminders).values(result.values);
  revalidate();
  return { error: null };
}

export async function updateReminder(id: string, input: ReminderInput): Promise<{ error: string | null }> {
  const result = validate(input);
  if ("error" in result) return result;
  await db.update(reminders).set(result.values).where(eq(reminders.id, id));
  revalidate();
  return { error: null };
}

export async function setReminderDone(id: string, done: boolean): Promise<void> {
  await db
    .update(reminders)
    .set({ completedAt: done ? new Date() : null })
    .where(eq(reminders.id, id));
  revalidate();
}

export async function deleteReminder(id: string): Promise<void> {
  await db.delete(reminders).where(eq(reminders.id, id));
  revalidate();
}

/**
 * Dismisses a listing follow-up from the Schedule page — clears the listing's
 * followUpAt/followUpNote, same as clearing the date in the listing modal
 * (updateListingFollowUp), so it also leaves Pipeline's "Follow-up due"
 * section. Returns what was cleared so the toast's Undo can put it back.
 */
export async function dismissListingFollowUp(
  listingId: string
): Promise<{ followUpAt: Date | null; followUpNote: string | null }> {
  const [before] = await db
    .select({ followUpAt: listings.followUpAt, followUpNote: listings.followUpNote })
    .from(listings)
    .where(eq(listings.id, listingId));
  await db.update(listings).set({ followUpAt: null, followUpNote: null }).where(eq(listings.id, listingId));
  revalidate();
  revalidatePath("/pipeline");
  revalidatePath("/");
  return before ?? { followUpAt: null, followUpNote: null };
}

export async function restoreListingFollowUp(
  listingId: string,
  followUpAt: Date | null,
  followUpNote: string | null
): Promise<void> {
  await db.update(listings).set({ followUpAt, followUpNote }).where(eq(listings.id, listingId));
  revalidate();
  revalidatePath("/pipeline");
  revalidatePath("/");
}
