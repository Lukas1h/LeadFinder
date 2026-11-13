import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { BOOKING_STAGES, previousStage, stageIndex, type BookingStage } from "./bookingStages";

/**
 * The only writer of bookings.stage (see src/lib/bookingStages.ts for the
 * states). Moving a booking stamps the timestamps of every step it has now
 * passed (keeping any already set) and clears the ones of steps it hasn't,
 * so shot_at / invoice_sent_at / completed_at / paid_at / date_tentative
 * always agree with the stage for the code that still reads them (the
 * ledger, the activity feed, near-shoot follow-ups, the phone app).
 */

type Row = typeof bookings.$inferSelect;
type StageFields = Pick<Row, "stage" | "dateTentative" | "shotAt" | "invoiceSentAt" | "completedAt" | "paidAt">;

/** The column values that put a booking in `stage`, given what it has now. */
export function stageUpdate(current: Omit<StageFields, "stage">, stage: BookingStage, now = new Date()): StageFields {
  const at = stageIndex(stage);
  const reached = (s: BookingStage) => at >= stageIndex(s);
  return {
    stage,
    dateTentative: stage === "tentative",
    shotAt: reached("editing") ? (current.shotAt ?? now) : null,
    invoiceSentAt: reached("invoice_sent") ? (current.invoiceSentAt ?? now) : null,
    completedAt: reached("completed") ? (current.completedAt ?? now) : null,
    // Completed means paid. Going back from completed un-pays it (a mistaken
    // "Mark paid"); a real Square payment would mark it paid again on sync.
    paidAt: reached("completed") ? (current.paidAt ?? now) : null,
  };
}

/** The stage a new booking starts in. */
export const initialStage = (dateTentative: boolean | null | undefined): BookingStage =>
  dateTentative ? "tentative" : "scheduled";

/** Sets a booking's stage outright. `extra` rides along in the same update (e.g. the job's hours). */
export async function setBookingStage(
  bookingId: string,
  stage: BookingStage,
  extra: Partial<Row> = {}
): Promise<Row | null> {
  const [current] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!current) return null;
  const [updated] = await db
    .update(bookings)
    .set({ ...extra, ...stageUpdate(current, stage) })
    .where(eq(bookings.id, bookingId))
    .returning();
  return updated ?? null;
}

/** Moves a booking forward to `stage` if it's behind it; never moves it back. */
export async function advanceBookingTo(bookingId: string, stage: BookingStage): Promise<Row | null> {
  const behind = BOOKING_STAGES.slice(0, stageIndex(stage));
  const [current] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), inArray(bookings.stage, behind)));
  if (!current) return null;
  return setBookingStage(bookingId, stage);
}

/** "Reopen": back one stage. No-op at tentative. */
export async function reopenBookingStage(bookingId: string): Promise<Row | null> {
  const [current] = await db.select({ stage: bookings.stage }).from(bookings).where(eq(bookings.id, bookingId));
  if (!current) return null;
  const prev = previousStage(current.stage);
  return prev ? setBookingStage(bookingId, prev) : null;
}

/**
 * The date-tentative checkbox on create/edit: flips tentative ⇄ scheduled
 * while the job is still to shoot, ignored once it's been shot.
 */
export async function applyDateTentative(bookingId: string, dateTentative: boolean): Promise<void> {
  const [current] = await db.select({ stage: bookings.stage }).from(bookings).where(eq(bookings.id, bookingId));
  if (!current || (current.stage !== "tentative" && current.stage !== "scheduled")) return;
  const want = initialStage(dateTentative);
  if (want !== current.stage) await setBookingStage(bookingId, want);
}
