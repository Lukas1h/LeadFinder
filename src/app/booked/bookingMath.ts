import type { BookingWithDetails } from "./BookedList";

/** What the client is billed: the line items' total. This is the number the Booked page shows. */
export function bookingRevenue(booking: Pick<BookingWithDetails, "lineItems">): number {
  return booking.lineItems.reduce((sum, li) => sum + li.amount, 0);
}

type ContractInputs = Pick<BookingWithDetails, "shooter">;

/**
 * What a contracted job costs on top of Lukas's own: the shooter's agreed pay
 * plus the photo editor (the booking's recorded editor cost, else
 * HDR_EDITOR_COST for an HDR shooter, 0 for flambient). 0 with no shooter.
 */
export function contractorCost(booking: ContractInputs): { pay: number; editor: number; total: number } {
  const s = booking.shooter;
  if (!s) return { pay: 0, editor: 0, total: 0 };
  const pay = s.pay ?? 0;
  const editor = s.editorCost;
  return { pay, editor, total: pay + editor };
}

/**
 * Real revenue (Lukas, 2026-11-26): what the job brings in after the people
 * it was contracted to. Own shoots: the line-item total. Contracted: the
 * total minus the shooter's pay and, for HDR shooters, the editor.
 */
export function realRevenue(booking: Pick<BookingWithDetails, "lineItems" | "shooter">): number {
  return bookingRevenue(booking) - contractorCost(booking).total;
}

/** What clients were billed (line items), for what's still owed: Outstanding. */
export function sumBilled(bookings: Pick<BookingWithDetails, "lineItems">[]): number {
  return bookings.reduce((sum, b) => sum + bookingRevenue(b), 0);
}

/** Real revenue summed (realRevenue). */
export function sumRevenue(bookings: Pick<BookingWithDetails, "lineItems" | "shooter">[]): number {
  return bookings.reduce((sum, b) => sum + realRevenue(b), 0);
}

type ProfitInputs = Pick<BookingWithDetails, "lineItems" | "costs" | "shooter">;

/**
 * Real revenue minus the job's gas and linked expenses (see
 * src/lib/finance/math.ts). A paid shooter's pay is already one of the linked
 * expenses (lib/shooters.ts writes it with the bookingId), so it is only
 * taken off separately while unpaid.
 */
export function bookingProfit(booking: ProfitInputs): number {
  const { pay, editor } = contractorCost(booking);
  const unpaidPay = booking.shooter && !booking.shooter.expenseId ? pay : 0;
  return bookingRevenue(booking) - unpaidPay - editor - booking.costs.gas - booking.costs.expenses;
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
