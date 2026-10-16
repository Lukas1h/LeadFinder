/**
 * The Finances pages' numbers, as plain data: Overview, Jobs, Mileage and
 * Taxes each get one function here, and both the web pages and the iPhone
 * API (src/app/api/app/v1/finances) render what it returns, so the two can
 * never disagree. Pure over a loaded Ledger.
 */

import { expenseCategory } from "./categories";
import type { Ledger } from "./ledger";
import {
  jobCosts,
  jobEconomics,
  monthOf,
  monthlySummary,
  tripCost,
  yearTaxView,
  type JobEconomics,
  type MonthSummary,
  type YearTaxView,
} from "./math";
import { businessTax, marginalRate, mileageRate, taxSaved, type TaxBreakdown } from "./tax";

export interface PeriodTotals {
  revenue: number;
  jobs: number;
  costs: number;
  gas: number;
  profit: number;
  hours: number;
  perHour: number | null;
  miles: number;
}

function totals(months: MonthSummary[]): PeriodTotals {
  const revenue = months.reduce((s, m) => s + m.revenue, 0);
  const costs = months.reduce((s, m) => s + m.costs, 0);
  const hours = months.reduce((s, m) => s + m.hours, 0);
  const profit = revenue - costs;
  return {
    revenue,
    jobs: months.reduce((s, m) => s + m.jobs, 0),
    costs,
    gas: months.reduce((s, m) => s + m.gas, 0),
    profit,
    hours,
    perHour: hours > 0 ? profit / hours : null,
    miles: months.reduce((s, m) => s + m.miles, 0),
  };
}

export interface OverviewReport {
  month: string;
  year: number;
  thisMonth: PeriodTotals;
  yearToDate: PeriodTotals;
  /** The business's estimated tax on this year's taxable profit (see taxReport). */
  yearTaxOwed: number;
  /** Newest first. */
  months: MonthSummary[];
  /** This year's costs by category, biggest first; "gas" is business miles' gas. */
  spend: { category: string; label: string; amount: number }[];
  mpg: number;
}

export function overviewReport(ledger: Ledger, today: string): OverviewReport {
  const month = monthOf(today);
  const year = Number(today.slice(0, 4));
  const months = monthlySummary(ledger, month);
  const yearMonths = months.filter((m) => m.month.startsWith(`${year}-`));
  const yearToDate = totals(yearMonths);

  const byCategory = new Map<string, number>([["gas", yearToDate.gas]]);
  for (const m of yearMonths)
    for (const [c, v] of Object.entries(m.costsByCategory)) byCategory.set(c, (byCategory.get(c) ?? 0) + v);

  const tax = yearTaxView(ledger, year);
  return {
    month,
    year,
    thisMonth: totals(months.filter((m) => m.month === month)),
    yearToDate,
    yearTaxOwed: businessTax(year, ledger.settings.otherWagesMonthly * 12, tax.taxableProfit).total,
    months: [...months].reverse(),
    spend: [...byCategory.entries()]
      .filter(([, v]) => v > 0.5)
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount]) => ({
        category,
        label: category === "gas" ? "Gas (business miles)" : expenseCategory(category).label,
        amount,
      })),
    mpg: ledger.mpg,
  };
}

export interface JobRow extends JobEconomics {
  bookingId: string;
  label: string;
  city: string | null;
  date: string;
}

export interface MultiJobDay {
  tripId: string;
  date: string;
  purpose: string;
  jobs: { bookingId: string; label: string }[];
  miles: number;
  revenue: number;
  gas: number;
  expenses: number;
  hours: number;
  profit: number;
  perHour: number | null;
}

export interface JobsReport {
  /** Every job that's been shot, newest first. */
  jobs: JobRow[];
  /** Drives that served several jobs, judged as the whole day. Newest first. */
  multiJobDays: MultiJobDay[];
}

export function jobsReport(ledger: Ledger): JobsReport {
  const costs = jobCosts(ledger);
  const jobs = ledger.bookings
    .filter((b) => b.earnedDate)
    .map((b): JobRow => ({ ...jobEconomics(b, costs.get(b.id)), bookingId: b.id, label: b.label, city: b.city, date: b.earnedDate! }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const bookingsById = new Map(ledger.bookings.map((b) => [b.id, b]));
  const multiJobDays = ledger.trips
    .filter((t) => t.bookingIds.length > 1)
    .map((t): MultiJobDay => {
      const linked = t.bookingIds.map((id) => bookingsById.get(id)).filter((b) => b != null);
      const revenue = linked.reduce((s, b) => s + b.revenue, 0);
      const expenses = t.bookingIds.reduce((s, id) => s + (costs.get(id)?.expenses ?? 0), 0);
      const gas = tripCost(t, ledger).gas;
      const hours = linked.reduce((s, b) => s + b.workHours, 0) + (t.driveMinutes ?? 0) / 60;
      const profit = revenue - gas - expenses;
      return {
        tripId: t.id,
        date: t.date,
        purpose: t.purpose,
        jobs: linked.map((b) => ({ bookingId: b.id, label: b.label })),
        miles: t.miles,
        revenue,
        gas,
        expenses,
        hours,
        profit,
        perHour: hours > 0 ? profit / hours : null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return { jobs, multiJobDays };
}

export interface TripReportRow {
  id: string;
  date: string;
  purpose: string;
  category: string;
  stops: string | null;
  miles: number;
  driveMinutes: number | null;
  milesEstimated: boolean;
  notes: string | null;
  bookingIds: string[];
  jobLabels: string[];
  gallons: number;
  pricePerGallon: number;
  gas: number;
  rate: number;
  deduction: number;
}

export interface MileageReport {
  year: number;
  mpg: number;
  yearMiles: number;
  yearTrips: number;
  yearDeduction: number;
  yearGas: number;
  /** Newest first. */
  trips: TripReportRow[];
}

export function mileageReport(ledger: Ledger, today: string): MileageReport {
  const year = Number(today.slice(0, 4));
  const labelById = new Map(ledger.bookings.map((b) => [b.id, b.label]));
  const trips = ledger.trips
    .map((t): TripReportRow => {
      const cost = tripCost(t, ledger);
      return {
        id: t.id,
        date: t.date,
        purpose: t.purpose,
        category: t.category,
        stops: t.stops,
        miles: t.miles,
        driveMinutes: t.driveMinutes,
        milesEstimated: t.milesEstimated,
        notes: t.notes,
        bookingIds: t.bookingIds,
        jobLabels: t.bookingIds.map((id) => labelById.get(id) ?? "Booking"),
        gallons: cost.gallons,
        pricePerGallon: cost.pricePerGallon,
        gas: cost.gas,
        rate: mileageRate(t.date),
        deduction: cost.mileageDeduction,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const thisYear = trips.filter((t) => t.date.startsWith(`${year}-`));
  return {
    year,
    mpg: ledger.mpg,
    yearMiles: thisYear.reduce((s, t) => s + t.miles, 0),
    yearTrips: thisYear.length,
    yearDeduction: thisYear.reduce((s, t) => s + t.deduction, 0),
    yearGas: thisYear.reduce((s, t) => s + t.gas, 0),
    trips,
  };
}

export interface TaxReport extends YearTaxView {
  year: number;
  otherWagesYearly: number;
  tax: TaxBreakdown;
  /** Tax share of taxable profit, or null with no profit. */
  effectiveRate: number | null;
  deductions: number;
  saved: number;
  savedByMileage: number;
  marginalRate: number;
  settings: { mpg: number; otherWagesMonthly: number };
}

export function taxReport(ledger: Ledger, year: number): TaxReport {
  const wages = ledger.settings.otherWagesMonthly * 12;
  const view = yearTaxView(ledger, year);
  const tax = businessTax(year, wages, view.taxableProfit);
  const deductions = view.deductibleExpenses + view.mileageDeduction;
  return {
    ...view,
    year,
    otherWagesYearly: wages,
    tax,
    effectiveRate: view.taxableProfit > 0 ? tax.total / view.taxableProfit : null,
    deductions,
    saved: taxSaved(year, wages, view.taxableProfit, deductions),
    savedByMileage: taxSaved(year, wages, view.taxableProfit, view.mileageDeduction),
    marginalRate: marginalRate(year, wages, view.taxableProfit),
    settings: ledger.settings,
  };
}
