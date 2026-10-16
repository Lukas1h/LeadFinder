import { db } from "@/db";
import { expenses } from "@/db/schema";
import { isNotNull, or } from "drizzle-orm";
import type { BookingCosts } from "@/app/booked/BookedList";
import { loadLedger } from "./ledger";
import { dollars, jobCosts } from "./math";

export interface BookingCostsEntry {
  costs: BookingCosts;
  /** Share of the trips' drive time; null when the job has no trip logged. */
  driveHours: number | null;
}

const NO_COSTS: BookingCosts = { miles: 0, gas: 0, expenses: 0, mileageDeduction: 0, trips: [], expenseItems: [] };

/** Every booking's trips and expenses, for the Booked page and the phone API. */
export async function loadBookingCosts(): Promise<(bookingId: string) => BookingCostsEntry> {
  const [ledger, linkedExpenses] = await Promise.all([
    loadLedger(),
    db
      .select({
        id: expenses.id,
        bookingId: expenses.bookingId,
        tripId: expenses.tripId,
        category: expenses.category,
        date: expenses.date,
        description: expenses.description,
        amountCents: expenses.amountCents,
        deductiblePercent: expenses.deductiblePercent,
      })
      .from(expenses)
      .where(or(isNotNull(expenses.bookingId), isNotNull(expenses.tripId))),
  ]);
  const costs = jobCosts(ledger);
  const tripById = new Map(ledger.trips.map((t) => [t.id, t]));

  return (bookingId) => {
    const c = costs.get(bookingId);
    if (!c) return { costs: NO_COSTS, driveHours: null };
    const trips = c.tripIds.map((id) => tripById.get(id)!);
    return {
      driveHours: trips.length > 0 ? Math.round(c.driveHours * 100) / 100 : null,
      costs: {
        miles: c.miles,
        gas: c.gas,
        expenses: c.expenses,
        mileageDeduction: c.mileageDeduction,
        trips: trips.map((t) => ({
          id: t.id,
          date: t.date,
          purpose: t.purpose,
          miles: t.miles,
          driveMinutes: t.driveMinutes,
          jobs: t.bookingIds.length,
        })),
        expenseItems: linkedExpenses
          .filter(
            (e) =>
              e.category !== "gas" &&
              e.category !== "personal" &&
              (e.bookingId === bookingId || (!e.bookingId && e.tripId != null && c.tripIds.includes(e.tripId)))
          )
          .map((e) => ({
            id: e.id,
            date: e.date,
            description: e.description,
            amount: dollars(e),
            deductiblePercent: e.deductiblePercent,
          })),
      },
    };
  };
}
