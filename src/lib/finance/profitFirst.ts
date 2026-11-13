/**
 * Profit First (Mike Michalowicz): every dollar collected is split by fixed
 * percentages into Profit, Owner's pay, Tax and Operating expenses, and the
 * business has to live on its OpEx share. Client-safe pure math over the
 * ledger, like math.ts.
 *
 * Cash basis, because Profit First is about money in the bank:
 * - Collected: a booking's line items, on the day it was paid (paidDate).
 * - Real revenue: collected minus subcontractors ("contract_labor" expenses),
 *   which is what the percentages split.
 * - OpEx spent: business costs, the way the ledger's "Real profit" counts them
 *   (business gas from trip miles, other business expenses with yearly ones
 *   spread over their months), minus subcontractors, which already came off.
 * - Allocation days are the 10th and the 25th: "since last allocation" is what
 *   came in after the last one, i.e. what to move on the next.
 */

import { isBusinessExpense } from "./categories";
import { monthLabel } from "./format";
import type { Ledger } from "./ledger";
import { dollars, tripCost } from "./math";

export const PF_ACCOUNTS = [
  { key: "profit", label: "Profit" },
  { key: "ownerPay", label: "Owner's pay" },
  { key: "tax", label: "Tax" },
  { key: "opex", label: "Operating expenses" },
] as const;

export type PfAccount = (typeof PF_ACCOUNTS)[number]["key"];

/** Whole percents per account, summing to 100. */
export type ProfitFirstPercents = Record<PfAccount, number>;

export const DEFAULT_PF_PERCENTS: ProfitFirstPercents = { profit: 5, ownerPay: 50, tax: 15, opex: 30 };

/** The expense category that comes off revenue before the split. */
export const SUBCONTRACTOR_CATEGORY = "contract_labor";

export interface PfPeriod {
  label: string;
  /** "YYYY-MM-DD", inclusive. */
  start: string;
  end: string;
  /** Bookings paid in the period. */
  jobs: number;
  collected: number;
  subcontractors: number;
  realRevenue: number;
  /** realRevenue × each percent. */
  allocations: Record<PfAccount, number>;
  opexSpent: number;
  /** allocations.opex − opexSpent; negative = spent more than the OpEx share. */
  opexLeft: number;
}

export interface ProfitFirstReport {
  percents: ProfitFirstPercents;
  /**
   * Paid from the last allocation day through today (or through yesterday when
   * today is an allocation day): what to move on `nextAllocationDate`.
   */
  sinceLastAllocation: PfPeriod;
  lastAllocationDate: string;
  nextAllocationDate: string;
  thisQuarter: PfPeriod;
  yearToDate: PfPeriod;
  /** This year's months, January through the current one, newest first. */
  months: PfPeriod[];
  /** Estimated income + self-employment tax on this year's profit so far (overviewReport's yearTaxOwed), to hold against yearToDate.allocations.tax. */
  taxOwedYtd: number;
}

export function percentsTotal(p: ProfitFirstPercents): number {
  return PF_ACCOUNTS.reduce((sum, { key }) => sum + p[key], 0);
}

// ---------------------------------------------------------------------------
// Date math, all in UTC strings so the Pacific date never slips a day.

const pad = (n: number) => String(n).padStart(2, "0");

function utcDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const monthStart = (year: number, month: number) => `${year}-${pad(month)}-01`;

const monthEnd = (year: number, month: number) => `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;

function addDays(date: string, n: number): string {
  const d = utcDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

/** The same day `n` months later, clamped to the last day of a shorter month. */
function addMonthsToDate(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return isoDate(new Date(Date.UTC(year, month - 1, Math.min(d, daysInMonth(year, month)))));
}

/** Profit First moves money on the 10th and the 25th. */
function nextAllocation(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const thisMonth = `${y}-${pad(m)}`;
  if (d <= 10) return `${thisMonth}-10`;
  if (d <= 25) return `${thisMonth}-25`;
  return `${addMonthsToDate(`${thisMonth}-01`, 1).slice(0, 7)}-10`;
}

/** The other allocation day just before `next`; the two alternate 10th/25th. */
function allocationBefore(next: string): string {
  const day = Number(next.slice(8));
  return day === 25 ? `${next.slice(0, 8)}10` : addMonthsToDate(`${next.slice(0, 8)}25`, -1);
}

/** "Nov 10" for a "YYYY-MM-DD". */
function dayMonthLabel(date: string): string {
  return `${monthLabel(date.slice(0, 7), false)} ${Number(date.slice(8))}`;
}

function quarterStart(today: string): { start: string; label: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const q = Math.floor((month - 1) / 3) + 1;
  return { start: `${year}-${pad((q - 1) * 3 + 1)}-01`, label: `Q${q} ${year}` };
}

function pfPeriod(
  ledger: Ledger,
  percents: ProfitFirstPercents,
  label: string,
  start: string,
  end: string
): PfPeriod {
  const inRange = (date: string) => date >= start && date <= end;

  let collected = 0;
  let jobs = 0;
  for (const b of ledger.bookings) {
    if (b.paidDate && inRange(b.paidDate)) {
      collected += b.revenue;
      jobs += 1;
    }
  }

  let subcontractors = 0;
  for (const e of ledger.expenses) {
    if (e.category === SUBCONTRACTOR_CATEGORY && inRange(e.date)) subcontractors += dollars(e);
  }

  // What the percentages split: everything collected, less the subs it paid for.
  const realRevenue = collected - subcontractors;
  const allocations: Record<PfAccount, number> = {
    profit: (realRevenue * percents.profit) / 100,
    ownerPay: (realRevenue * percents.ownerPay) / 100,
    tax: (realRevenue * percents.tax) / 100,
    opex: (realRevenue * percents.opex) / 100,
  };

  // OpEx spent the way "Real profit" counts it: business gas from trip miles,
  // plus other business expenses with yearly ones spread over their months.
  let opexSpent = 0;
  for (const trip of ledger.trips) {
    if (inRange(trip.date)) opexSpent += tripCost(trip, ledger).gas;
  }
  for (const e of ledger.expenses) {
    if (!isBusinessExpense(e.category)) continue;
    if (e.category === "gas" || e.category === SUBCONTRACTOR_CATEGORY) continue;
    const spread = Math.max(1, e.spreadMonths);
    const share = dollars(e) / spread;
    for (let i = 0; i < spread; i++) {
      const date = addMonthsToDate(e.date, i);
      if (date > end) break;
      if (date >= start) opexSpent += share;
    }
  }

  return {
    label,
    start,
    end,
    jobs,
    collected,
    subcontractors,
    realRevenue,
    allocations,
    opexSpent,
    opexLeft: allocations.opex - opexSpent,
  };
}

export function profitFirstReport(
  ledger: Ledger,
  percents: ProfitFirstPercents,
  today: string,
  taxOwedYtd: number
): ProfitFirstReport {
  const nextAllocationDate = nextAllocation(today);
  const lastAllocationDate = allocationBefore(nextAllocationDate);

  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const quarter = quarterStart(today);

  const months: PfPeriod[] = [];
  for (let m = month; m >= 1; m--) {
    const start = monthStart(year, m);
    const end = monthEnd(year, m) < today ? monthEnd(year, m) : today;
    months.push(pfPeriod(ledger, percents, monthLabel(start.slice(0, 7), false), start, end));
  }

  return {
    percents,
    // Windows run from one allocation day through the day before the next, so
    // nothing paid on an allocation day falls between two of them. On an
    // allocation day this is exactly what to move today.
    sinceLastAllocation: pfPeriod(
      ledger,
      percents,
      `Since ${dayMonthLabel(lastAllocationDate)}`,
      lastAllocationDate,
      today === nextAllocationDate ? addDays(today, -1) : today
    ),
    lastAllocationDate,
    nextAllocationDate,
    thisQuarter: pfPeriod(ledger, percents, quarter.label, quarter.start, today),
    yearToDate: pfPeriod(ledger, percents, String(year), `${year}-01-01`, today),
    months,
    taxOwedYtd,
  };
}
