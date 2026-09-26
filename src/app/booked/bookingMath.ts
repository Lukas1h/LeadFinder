import type { BookingWithDetails } from "./BookedList";

type ProfitInputs = Pick<BookingWithDetails, "lineItems" | "additionalCosts">;

/** Line-item total minus any additional costs recorded on completion. */
export function bookingProfit(booking: ProfitInputs): number {
  const total = booking.lineItems.reduce((sum, li) => sum + li.amount, 0);
  return total - (booking.additionalCosts ?? 0);
}

export function sumProfit(bookings: ProfitInputs[]): number {
  return bookings.reduce((sum, b) => sum + bookingProfit(b), 0);
}

export const COMPLETION_FIELDS = [
  { key: "driveHours", label: "Drive time", unit: "hours" },
  { key: "shootingHours", label: "Shooting", unit: "hours" },
  { key: "editingHours", label: "Editing", unit: "hours" },
  { key: "logisticsHours", label: "Logistics", unit: "hours" },
  { key: "additionalCosts", label: "Additional costs", unit: "dollars" },
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
    driveHours: parse(draft.driveHours),
    editingHours: parse(draft.editingHours),
    shootingHours: parse(draft.shootingHours),
    logisticsHours: parse(draft.logisticsHours),
    additionalCosts: draft.additionalCosts.trim() ? Math.round(Number(draft.additionalCosts)) || 0 : null,
  };
}
