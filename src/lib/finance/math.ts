/**
 * The ledger's arithmetic, as pure functions over plain rows so the pages,
 * the booking cards and the phone API all get the same numbers. Client-safe.
 *
 * Two views of the same money:
 * - Real profit is cash: revenue minus what the work actually cost. A trip's
 *   gas is its miles at the car's MPG and the price of the latest fill-up, not
 *   the gas receipts, because fill-ups also pay for personal driving.
 * - The tax view is what goes on Schedule C: revenue minus deductible
 *   expenses minus the mileage deduction (the IRS rate per mile, which stands
 *   in for gas and upkeep).
 */

import { isBusinessExpense } from "./categories";
import { mileageRate } from "./tax";

/** Used until there's a gas receipt with a price on it. */
export const DEFAULT_GAS_PRICE = 5;

export interface LedgerExpense {
  id: string;
  date: string;
  amountCents: number;
  category: string;
  deductiblePercent: number;
  gallons: number | null;
  pricePerGallon: number | null;
  spreadMonths: number;
  bookingId: string | null;
  tripId: string | null;
}

export interface LedgerTrip {
  id: string;
  date: string;
  miles: number;
  driveMinutes: number | null;
  bookingIds: string[];
}

export interface LedgerBooking {
  id: string;
  /** The day the work happened ("YYYY-MM-DD"), or null if it hasn't been shot. */
  earnedDate: string | null;
  revenue: number;
  /** Shooting + editing + logistics hours; drive time comes from trips. */
  workHours: number;
}

export interface LedgerInput {
  expenses: LedgerExpense[];
  trips: LedgerTrip[];
  bookings: LedgerBooking[];
  mpg: number;
}

const TZ = "America/Los_Angeles";

/** A moment's wall-clock Pacific date, "YYYY-MM-DD". */
export function pacificDate(at: Date): string {
  return at.toLocaleDateString("en-CA", { timeZone: TZ });
}

export const monthOf = (date: string) => date.slice(0, 7);

function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const dollars = (e: Pick<LedgerExpense, "amountCents">) => e.amountCents / 100;
export const deductibleAmount = (e: Pick<LedgerExpense, "amountCents" | "deductiblePercent">) =>
  (e.amountCents * e.deductiblePercent) / 10000;

/** A gas receipt's price per gallon, from the receipt or worked out from gallons. */
function receiptGasPrice(e: LedgerExpense): number | null {
  if (e.category !== "gas") return null;
  if (e.pricePerGallon && e.pricePerGallon > 0) return e.pricePerGallon;
  if (e.gallons && e.gallons > 0) return dollars(e) / e.gallons;
  return null;
}

/**
 * The price of gas on a day: the latest fill-up on or before it, else the
 * first one after (for trips before any priced receipt), else the default.
 */
export function gasPriceOn(date: string, expenses: LedgerExpense[]): number {
  const priced = expenses
    .map((e) => ({ date: e.date, price: receiptGasPrice(e) }))
    .filter((p): p is { date: string; price: number } => p.price != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const before = priced.filter((p) => p.date <= date).at(-1);
  return (before ?? priced[0])?.price ?? DEFAULT_GAS_PRICE;
}

export interface TripCost {
  gallons: number;
  pricePerGallon: number;
  gas: number;
  mileageDeduction: number;
}

export function tripCost(trip: Pick<LedgerTrip, "date" | "miles">, input: Pick<LedgerInput, "expenses" | "mpg">): TripCost {
  const pricePerGallon = gasPriceOn(trip.date, input.expenses);
  const gallons = input.mpg > 0 ? trip.miles / input.mpg : 0;
  return { gallons, pricePerGallon, gas: gallons * pricePerGallon, mileageDeduction: trip.miles * mileageRate(trip.date) };
}

/**
 * How a trip divides across its jobs: by each one's share of the revenue, so
 * the $450 job on a two-job day carries most of the drive. Evenly when none
 * of them earned anything.
 */
export function tripShares(trip: LedgerTrip, bookingsById: Map<string, LedgerBooking>): Map<string, number> {
  const linked = trip.bookingIds.filter((id) => bookingsById.has(id));
  const total = linked.reduce((sum, id) => sum + Math.max(0, bookingsById.get(id)!.revenue), 0);
  return new Map(
    linked.map((id) => [id, total > 0 ? Math.max(0, bookingsById.get(id)!.revenue) / total : 1 / linked.length])
  );
}

export interface JobCosts {
  miles: number;
  driveHours: number;
  gas: number;
  mileageDeduction: number;
  /** Business expenses charged to the job or its trips (meals, flash drives), gas receipts aside. */
  expenses: number;
  deductibleExpenses: number;
  tripIds: string[];
}

const emptyJobCosts = (): JobCosts => ({
  miles: 0,
  driveHours: 0,
  gas: 0,
  mileageDeduction: 0,
  expenses: 0,
  deductibleExpenses: 0,
  tripIds: [],
});

/** Each booking's share of the trips and expenses linked to it. */
export function jobCosts(input: LedgerInput): Map<string, JobCosts> {
  const bookingsById = new Map(input.bookings.map((b) => [b.id, b]));
  const out = new Map<string, JobCosts>();
  const get = (id: string) => {
    let c = out.get(id);
    if (!c) out.set(id, (c = emptyJobCosts()));
    return c;
  };

  for (const trip of input.trips) {
    const cost = tripCost(trip, input);
    for (const [bookingId, share] of tripShares(trip, bookingsById)) {
      const c = get(bookingId);
      c.miles += trip.miles * share;
      c.driveHours += ((trip.driveMinutes ?? 0) / 60) * share;
      c.gas += cost.gas * share;
      c.mileageDeduction += cost.mileageDeduction * share;
      c.tripIds.push(trip.id);
    }
  }

  const tripsById = new Map(input.trips.map((t) => [t.id, t]));
  for (const e of input.expenses) {
    // Gas receipts price the trips; counting them on the job too would pay for the drive twice.
    if (e.category === "gas" || !isBusinessExpense(e.category)) continue;
    // Charged to a job, or to a trip and so split across its jobs like the gas (lunch on a two-job day).
    const trip = !e.bookingId && e.tripId ? tripsById.get(e.tripId) : undefined;
    const shares = e.bookingId ? new Map([[e.bookingId, 1]]) : trip ? tripShares(trip, bookingsById) : new Map<string, number>();
    for (const [bookingId, share] of shares) {
      const c = get(bookingId);
      c.expenses += dollars(e) * share;
      c.deductibleExpenses += deductibleAmount(e) * share;
    }
  }

  return out;
}

export interface JobEconomics extends JobCosts {
  revenue: number;
  hours: number;
  /** Revenue minus gas and linked expenses. */
  profit: number;
  perHour: number | null;
  /** Profit if the car's full per-mile cost (the IRS rate) is charged instead of just gas. */
  profitAfterCarWear: number;
}

export function jobEconomics(booking: LedgerBooking, costs: JobCosts | undefined): JobEconomics {
  const c = costs ?? emptyJobCosts();
  const hours = booking.workHours + c.driveHours;
  const profit = booking.revenue - c.gas - c.expenses;
  return {
    ...c,
    revenue: booking.revenue,
    hours,
    profit,
    perHour: hours > 0 ? profit / hours : null,
    profitAfterCarWear: booking.revenue - c.mileageDeduction - c.expenses,
  };
}

export interface MonthSummary {
  month: string;
  revenue: number;
  jobs: number;
  miles: number;
  /** Business gas: trip miles priced at the latest fill-up. */
  gas: number;
  /** What the gas receipts came to, business and personal driving together. */
  gasBought: number;
  /** Business expenses other than gas, yearly charges spread over their months. */
  costsByCategory: Record<string, number>;
  costs: number;
  profit: number;
  /** Work hours on jobs plus all business driving. */
  hours: number;
  perHour: number | null;
  mileageDeduction: number;
  /** Deductible expenses as paid (not spread), the way the return counts them. */
  deductibleExpenses: number;
}

/** Month by month, oldest first, every month from the first activity through `through`. */
export function monthlySummary(input: LedgerInput, through: string): MonthSummary[] {
  const months = new Map<string, MonthSummary>();
  const get = (month: string) => {
    let m = months.get(month);
    if (!m) {
      m = {
        month,
        revenue: 0,
        jobs: 0,
        miles: 0,
        gas: 0,
        gasBought: 0,
        costsByCategory: {},
        costs: 0,
        profit: 0,
        hours: 0,
        perHour: null,
        mileageDeduction: 0,
        deductibleExpenses: 0,
      };
      months.set(month, m);
    }
    return m;
  };

  for (const b of input.bookings) {
    if (!b.earnedDate) continue;
    const m = get(monthOf(b.earnedDate));
    m.revenue += b.revenue;
    m.jobs += 1;
    m.hours += b.workHours;
  }

  for (const trip of input.trips) {
    const cost = tripCost(trip, input);
    const m = get(monthOf(trip.date));
    m.miles += trip.miles;
    m.gas += cost.gas;
    m.mileageDeduction += cost.mileageDeduction;
    m.hours += (trip.driveMinutes ?? 0) / 60;
  }

  for (const e of input.expenses) {
    const m = get(monthOf(e.date));
    m.deductibleExpenses += deductibleAmount(e);
    if (e.category === "gas") {
      m.gasBought += dollars(e);
      continue;
    }
    if (!isBusinessExpense(e.category)) continue;
    const spread = Math.max(1, e.spreadMonths);
    for (let i = 0; i < spread; i++) {
      const month = addMonths(monthOf(e.date), i);
      if (month > through) break;
      const target = get(month);
      target.costsByCategory[e.category] = (target.costsByCategory[e.category] ?? 0) + dollars(e) / spread;
    }
  }

  const sorted = [...months.values()].filter((m) => m.month <= through).sort((a, b) => a.month.localeCompare(b.month));
  if (sorted.length === 0) return [];
  // Fill quiet months so the table reads as a calendar.
  const filled: MonthSummary[] = [];
  for (let month = sorted[0].month; month <= through; month = addMonths(month, 1)) filled.push(get(month));

  for (const m of filled) {
    m.costs = m.gas + Object.values(m.costsByCategory).reduce((s, v) => s + v, 0);
    m.profit = m.revenue - m.costs;
    m.perHour = m.hours > 0 ? m.profit / m.hours : null;
  }
  return filled;
}

export interface YearTaxView {
  revenue: number;
  deductibleExpenses: number;
  mileageDeduction: number;
  miles: number;
  /** Schedule C's bottom line: revenue minus both deductions. */
  taxableProfit: number;
}

export function yearTaxView(input: LedgerInput, year: number): YearTaxView {
  const inYear = (date: string | null) => date != null && date.startsWith(`${year}-`);
  const revenue = input.bookings.filter((b) => inYear(b.earnedDate)).reduce((s, b) => s + b.revenue, 0);
  const deductibleExpenses = input.expenses.filter((e) => inYear(e.date)).reduce((s, e) => s + deductibleAmount(e), 0);
  const trips = input.trips.filter((t) => inYear(t.date));
  const mileageDeduction = trips.reduce((s, t) => s + t.miles * mileageRate(t.date), 0);
  const miles = trips.reduce((s, t) => s + t.miles, 0);
  return { revenue, deductibleExpenses, mileageDeduction, miles, taxableProfit: revenue - deductibleExpenses - mileageDeduction };
}
