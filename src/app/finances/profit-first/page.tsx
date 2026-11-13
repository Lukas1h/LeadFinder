import { Suspense } from "react";
import { connection } from "next/server";
import { Card } from "@/components/ui/card";
import { Stat, Sub } from "../../Stat";
import { FinanceSkeleton } from "../loading";
import { PercentsForm } from "./PercentsForm";
import { Allocations, OpexBar } from "./parts";
import { loadProfitFirstReport } from "@/lib/finance/profitFirstReport";
import type { PfPeriod, ProfitFirstReport } from "@/lib/finance/profitFirst";
import { dayLabel, formatDollars, monthLabel } from "@/lib/finance/format";

export default function ProfitFirstPage() {
  return (
    <Suspense fallback={<FinanceSkeleton />}>
      <ProfitFirst />
    </Suspense>
  );
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

async function ProfitFirst() {
  await connection();
  const r = await loadProfitFirstReport();
  const since = r.sinceLastAllocation;

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4 gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Move on {dayLabel(r.nextAllocationDate)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDollars(since.collected)} came in since {dayLabel(r.lastAllocationDate)} ({plural(since.jobs, "job")})
            {since.subcontractors > 0 && `, ${formatDollars(since.subcontractors)} of it to subcontractors`}. Split{" "}
            {formatDollars(since.realRevenue)}:
          </p>
        </div>
        <Allocations period={since} percents={r.percents} />
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <PeriodCard title={r.thisQuarter.label} period={r.thisQuarter} report={r} />
        <PeriodCard title={r.yearToDate.label} period={r.yearToDate} report={r} taxOwed={r.taxOwedYtd} />
      </div>

      {r.months.length > 0 && (
        <Card className="p-0 gap-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="text-left font-medium px-4 py-2">Month</th>
                <th className="text-right font-medium px-2 py-2">Collected</th>
                <th className="text-right font-medium px-2 py-2">Profit</th>
                <th className="text-right font-medium px-2 py-2">Owner&rsquo;s pay</th>
                <th className="text-right font-medium px-2 py-2">Tax</th>
                <th className="text-right font-medium px-2 py-2">OpEx</th>
                <th className="text-right font-medium px-2 py-2">OpEx spent</th>
                <th className="text-right font-medium px-4 py-2">Left</th>
              </tr>
            </thead>
            <tbody>
              {r.months.map((m) => (
                <tr key={m.start} className="border-b last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap">{monthLabel(m.start.slice(0, 7))}</td>
                  <td className="text-right px-2 py-2">{formatDollars(m.collected)}</td>
                  <td className="text-right px-2 py-2 text-muted-foreground">{formatDollars(m.allocations.profit)}</td>
                  <td className="text-right px-2 py-2 text-muted-foreground">{formatDollars(m.allocations.ownerPay)}</td>
                  <td className="text-right px-2 py-2 text-muted-foreground">{formatDollars(m.allocations.tax)}</td>
                  <td className="text-right px-2 py-2 text-muted-foreground">{formatDollars(m.allocations.opex)}</td>
                  <td className="text-right px-2 py-2 text-muted-foreground">{formatDollars(m.opexSpent)}</td>
                  <td className={`text-right px-4 py-2 font-medium ${m.opexLeft < 0 ? "text-destructive" : ""}`}>
                    {formatDollars(m.opexLeft)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-xs text-muted-foreground -mt-4">
        Cash basis: a job counts the day it was paid. Subcontractors come off before the split. OpEx spent is the
        business costs the Overview counts (gas from trip miles, other expenses, yearly ones spread over 12 months).
      </p>

      <PercentsForm key={JSON.stringify(r.percents)} percents={r.percents} />
    </div>
  );
}

function PeriodCard({
  title,
  period,
  report,
  taxOwed,
}: {
  title: string;
  period: PfPeriod;
  report: ProfitFirstReport;
  taxOwed?: number;
}) {
  const taxShort = taxOwed != null ? taxOwed - period.allocations.tax : 0;
  return (
    <Card className="p-4 gap-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Collected">
          {formatDollars(period.collected)}
          <Sub>{plural(period.jobs, "job")}</Sub>
        </Stat>
        <Stat label="Real revenue">
          {formatDollars(period.realRevenue)}
          <Sub>{period.subcontractors > 0 ? `after ${formatDollars(period.subcontractors)} subcontractors` : "nothing to subcontractors"}</Sub>
        </Stat>
      </div>
      <Allocations period={period} percents={report.percents} />
      <OpexBar period={period} />
      {taxOwed != null && (
        <p className="text-xs text-muted-foreground">
          Tax set aside {formatDollars(period.allocations.tax)} vs. {formatDollars(taxOwed)} estimated owed
          {taxShort > 0.5 ? (
            <span className="font-medium text-destructive"> · {formatDollars(taxShort)} short</span>
          ) : (
            <span> · covered</span>
          )}
        </p>
      )}
    </Card>
  );
}
