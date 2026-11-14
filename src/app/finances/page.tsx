import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { connection } from "next/server";
import { Card } from "@/components/ui/card";
import { Stat, Sub } from "../Stat";
import { FinanceSkeleton } from "./loading";
import { loadLedger } from "@/lib/finance/ledger";
import { pacificDate } from "@/lib/finance/math";
import { overviewReport } from "@/lib/finance/reports";
import { formatDollars, monthLabel } from "@/lib/finance/format";
import { loadProfitFirstReport } from "@/lib/finance/profitFirstReport";
import { Allocations, OpexBar } from "./profit-first/parts";
import { loadShooterSummary } from "@/lib/shooters";

export default function FinancesOverviewPage() {
  return (
    <Suspense fallback={<FinanceSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  await connection();
  const [ledger, pf, shooters] = await Promise.all([loadLedger(), loadProfitFirstReport(), loadShooterSummary()]);
  const r = overviewReport(ledger, pacificDate(new Date()));
  const { year, months, spend } = r;
  const thisMonth = r.month;
  const current = r.thisMonth;
  const ytd = r.yearToDate;
  const taxOwed = r.yearTaxOwed;
  const biggest = spend[0]?.amount ?? 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-4 gap-3">
          <p className="text-sm font-medium text-foreground">{monthLabel(thisMonth, false)} so far</p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Revenue">
              {formatDollars(current.revenue)}
              <Sub>{current.jobs} jobs</Sub>
            </Stat>
            <Stat label="Costs">
              {formatDollars(current.costs)}
              <Sub>{formatDollars(current.gas)} of it gas</Sub>
            </Stat>
            <Stat label="Real profit">{formatDollars(current.profit)}</Stat>
            <Stat label="Per hour">
              {current.perHour != null ? `${formatDollars(current.perHour)}/hr` : "—"}
              <Sub>{Math.round(current.hours)} h worked</Sub>
            </Stat>
          </div>
        </Card>
        <Card className="p-4 gap-3">
          <p className="text-sm font-medium text-foreground">{year} so far</p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Revenue">{formatDollars(ytd.revenue)}</Stat>
            <Stat label="Costs">{formatDollars(ytd.costs)}</Stat>
            <Stat label="Real profit">
              {formatDollars(ytd.profit)}
              <Sub>{ytd.perHour != null ? `${formatDollars(ytd.perHour)}/hr` : ""}</Sub>
            </Stat>
            <Stat label="Tax on it (est.)">
              {formatDollars(taxOwed)}
              <Sub>set aside, see Taxes</Sub>
            </Stat>
          </div>
        </Card>
      </div>

      <Link href="/finances/profit-first" className="block">
        <Card className="p-4 gap-3 hover:border-foreground/20 transition-colors">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">Profit First · {pf.thisQuarter.label}</p>
            <span className="flex items-center text-xs text-muted-foreground">
              {formatDollars(pf.thisQuarter.realRevenue)} to split
              <ChevronRight className="size-3.5" />
            </span>
          </div>
          <Allocations period={pf.thisQuarter} percents={pf.percents} />
          <OpexBar period={pf.thisQuarter} />
        </Card>
      </Link>

      {(shooters.byShooter.length > 0 || shooters.owed.length > 0) && <ShootersCard summary={shooters} />}

      <Card className="p-0 gap-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="text-left font-medium px-4 py-2">Month</th>
              <th className="text-right font-medium px-2 py-2">Revenue</th>
              <th className="text-right font-medium px-2 py-2">Gas</th>
              <th className="text-right font-medium px-2 py-2">Other costs</th>
              <th className="text-right font-medium px-2 py-2">Profit</th>
              <th className="text-right font-medium px-2 py-2">Per hour</th>
              <th className="text-right font-medium px-2 py-2">Miles</th>
              <th className="text-right font-medium px-4 py-2">Deductions</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-b last:border-0">
                <td className="px-4 py-2 whitespace-nowrap">{monthLabel(m.month)}</td>
                <td className="text-right px-2 py-2">{formatDollars(m.revenue)}</td>
                <td className="text-right px-2 py-2 text-muted-foreground">{formatDollars(m.gas)}</td>
                <td className="text-right px-2 py-2 text-muted-foreground">{formatDollars(m.costs - m.gas)}</td>
                <td className={`text-right px-2 py-2 font-medium ${m.profit < 0 ? "text-destructive" : ""}`}>
                  {formatDollars(m.profit)}
                </td>
                <td className="text-right px-2 py-2">{m.perHour != null ? formatDollars(m.perHour) : "—"}</td>
                <td className="text-right px-2 py-2 text-muted-foreground">{Math.round(m.miles)}</td>
                <td className="text-right px-4 py-2 text-muted-foreground">
                  {formatDollars(m.mileageDeduction + m.deductibleExpenses)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted-foreground -mt-4">
        Gas is business miles at {ledger.mpg} mpg and the latest fill-up&rsquo;s price, not the gas receipts (those
        also cover personal driving). Yearly subscriptions are spread over their 12 months. Deductions are the
        mileage deduction plus deductible expenses as paid.
      </p>

      {spend.length > 0 && (
        <Card className="p-4 gap-3">
          <p className="text-sm font-medium text-foreground">Where the money went in {year}</p>
          <div className="flex flex-col gap-2">
            {spend.map(({ category, label, amount }) => (
              <div key={category} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 truncate text-foreground/90">{label}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-foreground/70" style={{ width: `${(amount / biggest) * 100}%` }} />
                </div>
                <span className="w-16 text-right shrink-0">{formatDollars(amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function shortDay(ymd: string) {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ShootersCard({ summary }: { summary: Awaited<ReturnType<typeof loadShooterSummary>> }) {
  const { year, owed, owedTotal, byShooter, form1099Threshold } = summary;
  return (
    <Card className="p-4 gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">Shooters</p>
        {owed.length > 0 && (
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{formatDollars(owedTotal)} owed</span>
        )}
      </div>

      {owed.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Owed now</p>
          {owed.map((o) => (
            <Link
              key={o.bookingId}
              href="/booked"
              className="flex items-center justify-between gap-3 text-sm hover:text-foreground/70 transition-colors"
            >
              <span className="truncate text-foreground/90">
                {[o.address, o.city].filter(Boolean).join(", ") || "No address"}
                <span className="text-muted-foreground">
                  {o.jobDate ? ` · ${shortDay(o.jobDate)}` : ""} · {o.shooterName}
                </span>
              </span>
              <span className="shrink-0">{formatDollars(o.pay)}</span>
            </Link>
          ))}
        </div>
      )}

      {byShooter.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Paid in {year}</p>
          {byShooter.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-1.5 text-foreground/90">
                {s.name}
                <span className="text-muted-foreground">
                  · {s.jobs} {s.jobs === 1 ? "job" : "jobs"}
                </span>
                {s.needs1099 && (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    1099 needed
                  </span>
                )}
              </span>
              <span className="shrink-0">{formatDollars(s.paidTotal)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        A 1099-NEC is due for anyone paid {formatDollars(form1099Threshold)}+ in a year; get a W-9 before paying.
      </p>
    </Card>
  );
}
