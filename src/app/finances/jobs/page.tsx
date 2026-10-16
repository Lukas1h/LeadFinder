import { Suspense } from "react";
import { connection } from "next/server";
import { Card } from "@/components/ui/card";
import { FinanceSkeleton } from "../loading";
import { loadLedger } from "@/lib/finance/ledger";
import { jobCosts, jobEconomics, tripCost } from "@/lib/finance/math";
import { dayLabel, formatDollars } from "@/lib/finance/format";

export default function FinanceJobsPage() {
  return (
    <Suspense fallback={<FinanceSkeleton />}>
      <Jobs />
    </Suspense>
  );
}

const perHourText = (n: number | null) => (n != null ? `${formatDollars(n)}/hr` : "—");

async function Jobs() {
  await connection();
  const ledger = await loadLedger();
  const costs = jobCosts(ledger);

  const jobs = ledger.bookings
    .filter((b) => b.earnedDate)
    .map((b) => ({ booking: b, e: jobEconomics(b, costs.get(b.id)) }))
    .sort((a, b) => b.booking.earnedDate!.localeCompare(a.booking.earnedDate!));

  // A drive that served several jobs, judged as the whole day it was.
  const bookingsById = new Map(ledger.bookings.map((b) => [b.id, b]));
  const multiJobTrips = ledger.trips
    .filter((t) => t.bookingIds.length > 1)
    .map((t) => {
      const linked = t.bookingIds.map((id) => bookingsById.get(id)).filter((b) => b != null);
      const revenue = linked.reduce((s, b) => s + b.revenue, 0);
      const expenses = t.bookingIds.reduce((s, id) => s + (costs.get(id)?.expenses ?? 0), 0);
      const gas = tripCost(t, ledger).gas;
      const hours = linked.reduce((s, b) => s + b.workHours, 0) + (t.driveMinutes ?? 0) / 60;
      const profit = revenue - gas - expenses;
      return { trip: t, linked, revenue, gas, expenses, hours, profit, perHour: hours > 0 ? profit / hours : null };
    })
    .sort((a, b) => b.trip.date.localeCompare(a.trip.date));

  return (
    <div className="flex flex-col gap-6">
      {multiJobTrips.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Days with several jobs</p>
          {multiJobTrips.map(({ trip, linked, revenue, gas, expenses, hours, profit, perHour }) => (
            <Card key={trip.id} className="p-4 gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-foreground">
                  {dayLabel(trip.date)} · {trip.purpose}
                </span>
                <span className="font-semibold">{formatDollars(profit)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{linked.map((b) => b.label).join(" + ")}</p>
              <p className="text-sm text-muted-foreground">
                {formatDollars(revenue)} revenue − {formatDollars(gas)} gas
                {expenses > 0 ? ` − ${formatDollars(expenses)} expenses` : ""} · {Math.round(trip.miles)} mi ·{" "}
                {Math.round(hours * 10) / 10} h · <span className="text-foreground">{perHourText(perHour)}</span>
              </p>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-0 gap-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="text-left font-medium px-4 py-2">Job</th>
              <th className="text-right font-medium px-2 py-2">Revenue</th>
              <th className="text-right font-medium px-2 py-2">Gas</th>
              <th className="text-right font-medium px-2 py-2">Expenses</th>
              <th className="text-right font-medium px-2 py-2">Profit</th>
              <th className="text-right font-medium px-2 py-2">Hours</th>
              <th className="text-right font-medium px-2 py-2">Per hour</th>
              <th className="text-right font-medium px-4 py-2">Miles</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(({ booking, e }) => (
              <tr key={booking.id} className="border-b last:border-0 align-top">
                <td className="px-4 py-2">
                  <div className="text-foreground">{booking.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {dayLabel(booking.earnedDate!)}
                    {booking.city && booking.label !== booking.city ? ` · ${booking.city}` : ""}
                  </div>
                </td>
                <td className="text-right px-2 py-2">{formatDollars(e.revenue)}</td>
                <td className="text-right px-2 py-2 text-muted-foreground">{e.tripIds.length ? formatDollars(e.gas) : "—"}</td>
                <td className="text-right px-2 py-2 text-muted-foreground">{e.expenses ? formatDollars(e.expenses) : "—"}</td>
                <td className="text-right px-2 py-2">
                  <div className="font-medium">{formatDollars(e.profit)}</div>
                  {e.tripIds.length > 0 && (
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDollars(e.profitAfterCarWear)} w/ car wear
                    </div>
                  )}
                </td>
                <td className="text-right px-2 py-2 text-muted-foreground">{e.hours ? Math.round(e.hours * 10) / 10 : "—"}</td>
                <td className="text-right px-2 py-2">{perHourText(e.perHour)}</td>
                <td className="text-right px-4 py-2 text-muted-foreground">{e.tripIds.length ? Math.round(e.miles) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted-foreground -mt-4">
        A trip&rsquo;s miles, gas and drive time are split across its jobs by revenue. &ldquo;W/ car wear&rdquo; charges
        the IRS rate per mile (gas plus the car&rsquo;s upkeep and depreciation) instead of just gas. Hours are the
        shooting, editing and logistics recorded on the booking plus its share of the drive.
      </p>
    </div>
  );
}
