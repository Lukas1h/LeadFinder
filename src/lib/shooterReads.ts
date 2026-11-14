/**
 * The read side of shooters (see ./shooters.ts), with no next/cache import, so
 * the booking loaders can use it: src/app/booked/data.ts is also imported by
 * the client-side Booked list (for groupBookings), and a module that touches
 * revalidatePath can't be in a client bundle.
 */
import { asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { expenses, shooters } from "@/db/schema";

/** The shooter on one booking, as the Booked page and the app show it. */
export interface BookingShooter {
  id: string;
  name: string;
  /** Whole dollars agreed for this job; null until it's set. */
  pay: number | null;
  /** The linked expense's date ("YYYY-MM-DD") when paid; null while unpaid. */
  paidAt: string | null;
  expenseId: string | null;
}

/** Every shooter on file, for the picker on a booking. */
export async function listShooters(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: shooters.id, name: shooters.name }).from(shooters).orderBy(asc(shooters.name));
}

/**
 * The shooter for each of these bookings, batched: one shooters query and one
 * expenses query for the whole page (no per-row N+1). Every booking id gets an
 * entry — null when it has no shooter.
 */
export async function shootersByBookingId(
  rows: {
    id: string;
    shooterId: string | null;
    shooterPay: number | null;
    shooterExpenseId: string | null;
  }[]
): Promise<Map<string, BookingShooter | null>> {
  const shooterIds = [...new Set(rows.map((r) => r.shooterId).filter((id): id is string => id != null))];
  const expenseIds = [...new Set(rows.map((r) => r.shooterExpenseId).filter((id): id is string => id != null))];

  const [shooterRows, expenseRows] = await Promise.all([
    shooterIds.length > 0
      ? db.select({ id: shooters.id, name: shooters.name }).from(shooters).where(inArray(shooters.id, shooterIds))
      : Promise.resolve([]),
    expenseIds.length > 0
      ? db
          .select({ id: expenses.id, date: expenses.date })
          .from(expenses)
          .where(inArray(expenses.id, expenseIds))
      : Promise.resolve([]),
  ]);

  const shooterById = new Map(shooterRows.map((s) => [s.id, s]));
  const expenseDateById = new Map(expenseRows.map((e) => [e.id, e.date]));

  const out = new Map<string, BookingShooter | null>();
  for (const row of rows) {
    const shooter = row.shooterId ? shooterById.get(row.shooterId) : undefined;
    out.set(
      row.id,
      shooter
        ? {
            id: shooter.id,
            name: shooter.name,
            pay: row.shooterPay,
            paidAt: row.shooterExpenseId ? (expenseDateById.get(row.shooterExpenseId) ?? null) : null,
            expenseId: row.shooterExpenseId,
          }
        : null
    );
  }
  return out;
}
