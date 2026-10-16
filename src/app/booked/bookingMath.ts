import type { BookingWithDetails } from "./BookedList";

type ProfitInputs = Pick<BookingWithDetails, "lineItems" | "costs">;

/** Line-item total minus the job's gas and linked expenses (see src/lib/finance/math.ts). */
export function bookingProfit(booking: ProfitInputs): number {
  const total = booking.lineItems.reduce((sum, li) => sum + li.amount, 0);
  return total - booking.costs.gas - booking.costs.expenses;
}

/**
 * Profit per hour worked across all recorded hours (drive, shooting,
 * editing, logistics), or null if no hours have been recorded.
 */
type HourInputs = Pick<BookingWithDetails, "driveHours" | "shootingHours" | "editingHours" | "logisticsHours">;

export function totalHours(booking: HourInputs): number {
  return [booking.driveHours, booking.shootingHours, booking.editingHours, booking.logisticsHours].reduce<number>(
    (sum, h) => sum + (h ?? 0),
    0
  );
}

export function profitPerHour(booking: ProfitInputs & HourInputs): number | null {
  const hours = totalHours(booking);
  return hours > 0 ? bookingProfit(booking) / hours : null;
}

/**
 * Overall profit per hour across bookings, counting only the ones with
 * hours recorded — a booking with profit but no hours would inflate it.
 */
export function averageProfitPerHour(bookings: (ProfitInputs & HourInputs)[]): number | null {
  const timed = bookings.filter((b) => totalHours(b) > 0);
  const hours = timed.reduce((sum, b) => sum + totalHours(b), 0);
  return hours > 0 ? sumProfit(timed) / hours : null;
}

export function sumProfit(bookings: ProfitInputs[]): number {
  return bookings.reduce((sum, b) => sum + bookingProfit(b), 0);
}

// Drive time isn't here: it comes from the job's trip, with the miles.
export const COMPLETION_FIELDS = [
  { key: "shootingHours", label: "Shooting", unit: "hours" },
  { key: "editingHours", label: "Editing", unit: "hours" },
  { key: "logisticsHours", label: "Logistics", unit: "hours" },
] as const;

export type CompletionKey = (typeof COMPLETION_FIELDS)[number]["key"];
export type CompletionDraft = Record<CompletionKey, string>;

export function toCompletionDraft(booking?: Pick<BookingWithDetails, CompletionKey>): CompletionDraft {
  const draft = {} as CompletionDraft;
  for (const { key } of COMPLETION_FIELDS) draft[key] = booking?.[key] != null ? String(booking[key]) : "";
  return draft;
}

/** Blank inputs become null ("not recorded"), not 0. */
export function fromCompletionDraft(draft: CompletionDraft): Record<CompletionKey, number | null> {
  const parse = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    editingHours: parse(draft.editingHours),
    shootingHours: parse(draft.shootingHours),
    logisticsHours: parse(draft.logisticsHours),
  };
}

type StepFields = { completedAt: Date | null; invoiceSentAt: Date | null; shotAt: Date | null };

/** What "Reopen" clears: the latest step the booking has reached (Completed, then Invoice sent, then Shot). */
export function reopenStep(booking: StepFields): Partial<StepFields> {
  if (booking.completedAt) return { completedAt: null };
  if (booking.invoiceSentAt) return { invoiceSentAt: null };
  return { shotAt: null };
}
