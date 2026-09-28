"use server";

import { db } from "@/db";
import { listings, reminders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { validateReminderInput, type ReminderInput } from "@/lib/reminders";

export type { ReminderInput };

function revalidate() {
  revalidatePath("/schedule");
}

export async function createReminder(input: ReminderInput): Promise<{ error: string | null }> {
  const result = validateReminderInput(input);
  if ("error" in result) return result;
  await db.insert(reminders).values(result.values);
  revalidate();
  return { error: null };
}

export async function updateReminder(id: string, input: ReminderInput): Promise<{ error: string | null }> {
  const result = validateReminderInput(input);
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
