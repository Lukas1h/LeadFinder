/**
 * A booking's lifecycle, one state at a time. Client-safe (no db): the
 * badges, the Booked page buckets and the phone API all read it from here.
 *
 *   tentative → scheduled → editing → invoice_sent → completed
 *
 * - tentative: the agent said yes but the day isn't settled.
 * - scheduled: the day is set, not shot yet.
 * - editing: shot ("Mark shot"), photos not delivered yet.
 * - invoice_sent: the gallery (which carries the invoice) went out, or
 *   "Mark invoice sent". Waiting for payment.
 * - completed: paid. Square marks it automatically; cash/check/$0 jobs by
 *   "Mark paid". Never completed while unpaid.
 *
 * Writes go through src/lib/bookingStage.ts (server), which keeps the old
 * timestamps (shot_at, invoice_sent_at, completed_at, paid_at) and
 * date_tentative in step for everything that still reads them.
 */

export const BOOKING_STAGES = ["tentative", "scheduled", "editing", "invoice_sent", "completed"] as const;
export type BookingStage = (typeof BOOKING_STAGES)[number];

export const STAGE_LABELS: Record<BookingStage, string> = {
  tentative: "Tentative",
  scheduled: "Scheduled",
  editing: "Editing",
  invoice_sent: "Invoice sent",
  completed: "Completed",
};

export function isBookingStage(value: unknown): value is BookingStage {
  return typeof value === "string" && (BOOKING_STAGES as readonly string[]).includes(value);
}

export const stageIndex = (stage: BookingStage) => BOOKING_STAGES.indexOf(stage);

/** The stage before this one (what "Reopen" goes back to), or null at the start. */
export function previousStage(stage: BookingStage): BookingStage | null {
  const i = stageIndex(stage);
  return i > 0 ? BOOKING_STAGES[i - 1] : null;
}

/** Still to shoot: tentative or scheduled. */
export const isUpcomingStage = (stage: BookingStage) => stage === "tentative" || stage === "scheduled";
