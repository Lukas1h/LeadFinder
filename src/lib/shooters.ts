/**
 * Subcontracted photographers ("shooters") on bookings. Portland jobs go to
 * one; Lukas still does the editing. A booking carries the name and what he
 * agreed to pay (bookings.shooterPay, whole dollars like line items), and once
 * it's paid, bookings.shooterExpenseId points at the "Subcontractors" expense
 * that records the payment (see lib/finance/categories) — which is what takes
 * the pay off the job's profit and onto the shooter's year total for the 1099.
 *
 * The forms, the phone API and the MCP tools all go through here so a payment
 * is always logged the same way.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
export { shootersByBookingId, listShooters, type BookingShooter } from "./shooterReads";
import { db } from "@/db";
import { bookings, expenses, listings, shooters } from "@/db/schema";
import type { BookingStage } from "@/lib/bookingStages";
import { pacificDate } from "@/lib/finance/math";
import { writeExpense, type ExpenseInput } from "@/lib/finance/writes";


/** The address a "Shoot at ..." expense description uses: the linked listing's, else the booking's. */
function shootAddress(row: { address: string | null; city: string | null; listingAddress: string | null; listingCity: string | null }) {
  return row.listingAddress ?? row.address ?? row.city ?? row.listingCity ?? null;
}

async function loadBookingShooterRow(bookingId: string) {
  const [row] = await db
    .select({
      id: bookings.id,
      shooterId: bookings.shooterId,
      shooterPay: bookings.shooterPay,
      shooterExpenseId: bookings.shooterExpenseId,
      address: bookings.address,
      city: bookings.city,
      listingAddress: listings.address,
      listingCity: listings.city,
    })
    .from(bookings)
    .leftJoin(listings, eq(listings.id, bookings.listingId))
    .where(eq(bookings.id, bookingId));
  return row ?? null;
}

/** Finds a shooter by name (case-insensitive, trimmed), or adds a new one. */
async function findOrCreateShooter(name: string): Promise<{ id: string; name: string }> {
  const clean = name.trim();
  const [existing] = await db
    .select({ id: shooters.id, name: shooters.name })
    .from(shooters)
    .where(sql`lower(${shooters.name}) = ${clean.toLowerCase()}`)
    .limit(1);
  if (existing) return existing;

  // onConflictDoNothing so two saves of a new name at once can't blow up on the
  // unique constraint; the loser just reads the row the winner made.
  const [created] = await db.insert(shooters).values({ name: clean }).onConflictDoNothing().returning({
    id: shooters.id,
    name: shooters.name,
  });
  if (created) return created;

  const [row] = await db
    .select({ id: shooters.id, name: shooters.name })
    .from(shooters)
    .where(sql`lower(${shooters.name}) = ${clean.toLowerCase()}`)
    .limit(1);
  return row;
}

/** The Booked page and Finances both show shooter money, so both refresh. */
function revalidateShooterPaths() {
  revalidatePath("/booked");
  revalidatePath("/finances");
}

/**
 * Attaches a shooter (and their pay) to a booking, or clears it with a null /
 * blank name. Clearing also deletes the pay expense if one was already logged,
 * so the job's costs follow the booking back to "Lukas shot it".
 *
 * Once the pay has been logged, changing the shooter or the amount updates
 * that same expense rather than leaving a stale amount (or the wrong vendor)
 * on the books.
 */
export async function setBookingShooter(
  bookingId: string,
  input: { name: string; pay: number | null } | null
): Promise<{ error?: string }> {
  const booking = await loadBookingShooterRow(bookingId);
  if (!booking) return { error: "No booking with that id" };

  const name = input?.name.trim() ?? "";
  if (!name) {
    if (booking.shooterExpenseId) await db.delete(expenses).where(eq(expenses.id, booking.shooterExpenseId));
    await db
      .update(bookings)
      .set({ shooterId: null, shooterPay: null, shooterExpenseId: null })
      .where(eq(bookings.id, bookingId));
    revalidateShooterPaths();
    return {};
  }

  const rawPay = input?.pay ?? null;
  if (rawPay != null && !Number.isFinite(rawPay)) return { error: "Enter the shooter's pay as a number" };
  const pay = rawPay == null ? null : Math.round(rawPay);
  if (pay != null && pay < 0) return { error: "The shooter's pay can't be negative" };

  const shooter = await findOrCreateShooter(name);
  await db.update(bookings).set({ shooterId: shooter.id, shooterPay: pay }).where(eq(bookings.id, bookingId));

  // Already paid: keep the expense in step with the new name/amount.
  if (booking.shooterExpenseId) {
    const [expense] = await db.select().from(expenses).where(eq(expenses.id, booking.shooterExpenseId));
    if (expense) {
      const amount = pay ?? 0;
      const description = `Shoot at ${shootAddress(booking) || "booking"}`;
      if (expense.vendor !== shooter.name || expense.amountCents !== Math.round(amount * 100) || expense.description !== description) {
        const result = await writeExpense(expense.id, expenseInput(expense, { amount, vendor: shooter.name, description }));
        if (result.error) return { error: result.error };
      }
    }
  }

  revalidateShooterPaths();
  return {};
}

/** An existing pay expense, rewritten with a new amount/vendor/description, everything else untouched. */
function expenseInput(
  row: typeof expenses.$inferSelect,
  change: { amount: number; vendor: string; description: string }
): ExpenseInput {
  return {
    date: row.date,
    amount: change.amount,
    vendor: change.vendor,
    description: change.description,
    category: row.category,
    deductiblePercent: row.deductiblePercent,
    gallons: row.gallons,
    pricePerGallon: row.pricePerGallon,
    paidPersonally: row.paidPersonally,
    spreadMonths: row.spreadMonths,
    refunded: row.refundedCents / 100,
    refundedOn: row.refundedOn,
    bookingId: row.bookingId,
    tripId: row.tripId,
    notes: row.notes,
  };
}

/**
 * "Paid <name>": logs the agreed pay as a Subcontractors expense on the job
 * (one per booking, dated today) and remembers it, or removes it again when
 * un-marking. Paying needs a shooter and a positive amount first.
 */
export async function setShooterPaid(bookingId: string, paid: boolean): Promise<{ error?: string }> {
  const booking = await loadBookingShooterRow(bookingId);
  if (!booking) return { error: "No booking with that id" };

  if (!paid) {
    if (!booking.shooterExpenseId) return {};
    await db.delete(expenses).where(eq(expenses.id, booking.shooterExpenseId));
    await db.update(bookings).set({ shooterExpenseId: null }).where(eq(bookings.id, bookingId));
    revalidateShooterPaths();
    return {};
  }

  // Already paid: nothing to do (don't log the job twice).
  if (booking.shooterExpenseId) return {};

  const [shooter] = booking.shooterId
    ? await db.select({ name: shooters.name }).from(shooters).where(eq(shooters.id, booking.shooterId))
    : [];
  const pay = booking.shooterPay;
  if (!shooter || pay == null || pay <= 0) return { error: "Set the shooter's pay first" };

  const result = await writeExpense(null, {
    date: pacificDate(new Date()),
    amount: pay,
    vendor: shooter.name,
    description: `Shoot at ${shootAddress(booking) || "booking"}`,
    category: "contract_labor",
    deductiblePercent: 100,
    gallons: null,
    pricePerGallon: null,
    paidPersonally: false,
    spreadMonths: 1,
    refunded: 0,
    refundedOn: null,
    bookingId,
    tripId: null,
    notes: null,
  });
  if (result.error || !result.id) return { error: result.error ?? "Couldn't log the payment" };

  await db.update(bookings).set({ shooterExpenseId: result.id }).where(eq(bookings.id, bookingId));
  revalidateShooterPaths();
  return {};
}

/**
 * Payments of $2,000+ to one contractor in a year need a 1099-NEC starting
 * with 2026 payments ($600 before). Confirm with a tax pro.
 */
const FORM_1099_NEC_THRESHOLD = 2000;

export interface ShooterSummary {
  year: number;
  /** Shot jobs whose shooter hasn't been paid yet, oldest job first. */
  owed: {
    bookingId: string;
    address: string | null;
    city: string | null;
    jobDate: string | null;
    shooterName: string;
    pay: number;
  }[];
  owedTotal: number;
  /** Every shooter's pay logged this year, for the 1099. Shooters with none are listed with 0. */
  byShooter: { id: string; name: string; paidTotal: number; jobs: number; needs1099: boolean }[];
  form1099Threshold: number;
}

/** The Finances page's shooter section: what's owed, and who was paid what this year. */
export async function loadShooterSummary(): Promise<ShooterSummary> {
  const year = Number(pacificDate(new Date()).slice(0, 4));

  const [owedRows, byShooterRows] = await Promise.all([
    db
      .select({
        bookingId: bookings.id,
        address: sql<string | null>`coalesce(${listings.address}, ${bookings.address})`,
        city: sql<string | null>`coalesce(${listings.city}, ${bookings.city})`,
        jobDate: bookings.jobDate,
        shooterName: shooters.name,
        pay: sql<number>`coalesce(${bookings.shooterPay}, 0)::int`,
      })
      .from(bookings)
      .innerJoin(shooters, eq(shooters.id, bookings.shooterId))
      .leftJoin(listings, eq(listings.id, bookings.listingId))
      .where(
        and(
          sql`${bookings.shooterPay} > 0`,
          isNull(bookings.shooterExpenseId),
          // Shot, or further along: the work is done, so the pay is owed.
          inArray(bookings.stage, ["editing", "invoice_sent", "completed"] as BookingStage[])
        )
      )
      // Oldest job first: the one waiting longest is the one to pay.
      .orderBy(asc(bookings.jobDate)),
    db
      .select({
        id: shooters.id,
        name: shooters.name,
        // Only this year's linked pay expenses count; the join's date condition
        // leaves bookings paid in other years (or not paid at all) unmatched.
        jobs: sql<number>`count(${expenses.id})::int`,
        paidCents: sql<number>`coalesce(sum(${expenses.amountCents} - ${expenses.refundedCents}), 0)::int`,
      })
      .from(shooters)
      .leftJoin(bookings, eq(bookings.shooterId, shooters.id))
      .leftJoin(
        expenses,
        and(eq(expenses.id, bookings.shooterExpenseId), sql`extract(year from ${expenses.date}) = ${year}`)
      )
      .groupBy(shooters.id, shooters.name)
      .orderBy(asc(shooters.name)),
  ]);

  const owed = owedRows.map((r) => ({
    bookingId: r.bookingId,
    address: r.address,
    city: r.city,
    jobDate: r.jobDate ? pacificDate(r.jobDate) : null,
    shooterName: r.shooterName,
    pay: Number(r.pay),
  }));

  return {
    year,
    owed,
    owedTotal: owed.reduce((sum, r) => sum + r.pay, 0),
    byShooter: byShooterRows.map((r) => {
      const paidTotal = Number(r.paidCents) / 100;
      return {
        id: r.id,
        name: r.name,
        paidTotal,
        jobs: Number(r.jobs),
        needs1099: paidTotal >= FORM_1099_NEC_THRESHOLD,
      };
    }),
    form1099Threshold: FORM_1099_NEC_THRESHOLD,
  };
}
