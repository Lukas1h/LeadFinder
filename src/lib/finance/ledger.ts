import { db } from "@/db";
import { appSettings, bookingLineItems, bookings, expenses, listings, tripBookings, trips } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { pacificDate, type LedgerBooking, type LedgerExpense, type LedgerInput, type LedgerTrip } from "./math";
import { DEFAULT_PF_PERCENTS, type ProfitFirstPercents } from "./profitFirst";

/**
 * Loads the whole ledger: every expense, trip and booking. It's a one-person
 * business, so "everything" is a few hundred rows, and loading it all keeps
 * the gas-price lookup and the trip splits honest (a trip in March needs the
 * fill-up from February).
 */

export interface FinanceSettings {
  mpg: number;
  otherWagesMonthly: number;
}

export async function getFinanceSettings(): Promise<FinanceSettings> {
  const [row] = await db
    .select({ mpg: appSettings.vehicleMpg, wages: appSettings.otherWagesMonthly })
    .from(appSettings)
    .limit(1);
  return { mpg: row?.mpg ?? 20, otherWagesMonthly: row?.wages ?? 0 };
}

/** The Profit First split: whole percents per account, or the defaults before settings exist. */
export async function getProfitFirstPercents(): Promise<ProfitFirstPercents> {
  const [row] = await db
    .select({
      profit: appSettings.pfProfitPct,
      ownerPay: appSettings.pfOwnerPayPct,
      tax: appSettings.pfTaxPct,
      opex: appSettings.pfOpexPct,
    })
    .from(appSettings)
    .limit(1);
  if (!row) return { ...DEFAULT_PF_PERCENTS };
  return { profit: row.profit, ownerPay: row.ownerPay, tax: row.tax, opex: row.opex };
}

/** The work happened once it's been shot (or invoiced, or finished). */
function earnedDate(b: { jobDate: Date | null; shotAt: Date | null; invoiceSentAt: Date | null; completedAt: Date | null }) {
  if (!b.shotAt && !b.invoiceSentAt && !b.completedAt) return null;
  const candidates = [b.jobDate, b.shotAt].filter((d): d is Date => d != null);
  const at = candidates.length > 0 ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : (b.completedAt ?? b.invoiceSentAt)!;
  return pacificDate(at);
}

/** The day the money landed: paidAt, or completedAt for jobs marked complete before paidAt existed. */
function paidDate(b: { paidAt: Date | null; completedAt: Date | null }): string | null {
  const at = b.paidAt ?? b.completedAt;
  return at ? pacificDate(at) : null;
}

export interface LedgerBookingRow extends LedgerBooking {
  label: string;
  city: string | null;
  jobDate: Date | null;
  /** The day the job was paid (stage "completed"), or null while it's still open. */
  paidDate: string | null;
}

export interface LedgerTripRow extends LedgerTrip {
  purpose: string;
  category: string;
  stops: string | null;
  milesEstimated: boolean;
  notes: string | null;
}

export interface Ledger extends LedgerInput {
  bookings: LedgerBookingRow[];
  trips: LedgerTripRow[];
  settings: FinanceSettings;
}

export async function loadLedger(): Promise<Ledger> {
  const [expenseRows, tripRows, links, bookingRows, settings] = await Promise.all([
    db.select().from(expenses),
    db.select().from(trips),
    db.select().from(tripBookings),
    db
      .select({
        id: bookings.id,
        address: sql<string | null>`coalesce(${listings.address}, ${bookings.address})`,
        city: sql<string | null>`coalesce(${listings.city}, ${bookings.city})`,
        jobDate: bookings.jobDate,
        stage: bookings.stage,
        paidAt: bookings.paidAt,
        shotAt: bookings.shotAt,
        invoiceSentAt: bookings.invoiceSentAt,
        completedAt: bookings.completedAt,
        shootingHours: bookings.shootingHours,
        editingHours: bookings.editingHours,
        logisticsHours: bookings.logisticsHours,
        revenue: sql<number>`coalesce((select sum(${bookingLineItems.amount}) from ${bookingLineItems} where ${bookingLineItems.bookingId} = ${bookings.id}), 0)::int`,
      })
      .from(bookings)
      .leftJoin(listings, eq(listings.id, bookings.listingId)),
    getFinanceSettings(),
  ]);

  const bookingIdsByTrip = new Map<string, string[]>();
  for (const l of links) bookingIdsByTrip.set(l.tripId, [...(bookingIdsByTrip.get(l.tripId) ?? []), l.bookingId]);

  return {
    mpg: settings.mpg,
    settings,
    expenses: expenseRows.map(
      (e): LedgerExpense => ({
        id: e.id,
        date: e.date,
        amountCents: e.amountCents - e.refundedCents,
        category: e.category,
        deductiblePercent: e.deductiblePercent,
        gallons: e.gallons,
        pricePerGallon: e.pricePerGallon,
        spreadMonths: e.spreadMonths,
        bookingId: e.bookingId,
        tripId: e.tripId,
      })
    ),
    trips: tripRows.map(
      (t): LedgerTripRow => ({
        id: t.id,
        date: t.date,
        miles: t.miles,
        driveMinutes: t.driveMinutes,
        bookingIds: bookingIdsByTrip.get(t.id) ?? [],
        purpose: t.purpose,
        category: t.category,
        stops: t.stops,
        milesEstimated: t.milesEstimated,
        notes: t.notes,
      })
    ),
    bookings: bookingRows.map(
      (b): LedgerBookingRow => ({
        id: b.id,
        label: b.address?.trim() || b.city || "Booking",
        city: b.city,
        jobDate: b.jobDate,
        earnedDate: earnedDate(b),
        paidDate: b.stage === "completed" ? paidDate(b) : null,
        revenue: Number(b.revenue),
        workHours: (b.shootingHours ?? 0) + (b.editingHours ?? 0) + (b.logisticsHours ?? 0),
      })
    ),
  };
}
