import { Suspense } from "react";
import { connection } from "next/server";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Stat, Sub } from "../../Stat";
import { FinanceSkeleton } from "../loading";
import { FinanceSettingsForm } from "./FinanceSettingsForm";
import { loadLedger } from "@/lib/finance/ledger";
import { pacificDate } from "@/lib/finance/math";
import { taxReport } from "@/lib/finance/reports";
import { formatDollars } from "@/lib/finance/format";

export default function FinanceTaxesPage() {
  return (
    <Suspense fallback={<FinanceSkeleton />}>
      <Taxes />
    </Suspense>
  );
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

async function Taxes() {
  await connection();
  const year = Number(pacificDate(new Date()).slice(0, 4));
  const r = taxReport(await loadLedger(), year);
  const view = r;
  const { tax, saved, savedByMileage } = r;
  const rate = r.marginalRate;
  const wages = r.otherWagesYearly;

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4 gap-3">
        <p className="text-sm font-medium text-foreground">{year} so far, the way the tax return sees it</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Revenue">{formatDollars(view.revenue)}</Stat>
          <Stat label="Deductible expenses">−{formatDollars(view.deductibleExpenses)}</Stat>
          <Stat label="Mileage deduction">
            −{formatDollars(view.mileageDeduction)}
            <Sub>{Math.round(view.miles).toLocaleString()} mi</Sub>
          </Stat>
          <Stat label="Taxable profit">{formatDollars(view.taxableProfit)}</Stat>
        </div>
      </Card>

      <Card className="p-4 gap-3">
        <p className="text-sm font-medium text-foreground">What the business owes on that (estimate)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Self-employment">{formatDollars(tax.selfEmployment)}</Stat>
          <Stat label="Federal income">{formatDollars(tax.federal)}</Stat>
          <Stat label="Oregon">{formatDollars(tax.oregon)}</Stat>
          <Stat label="Total to set aside">
            {formatDollars(tax.total)}
            <Sub>{r.effectiveRate != null ? `${pct(r.effectiveRate)} of profit` : ""}</Sub>
          </Stat>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t pt-3">
          <Stat label="Deductions saved you">
            {formatDollars(saved)}
            <Sub>{formatDollars(savedByMileage)} from mileage</Sub>
          </Stat>
          <Stat label="Next dollar of profit">
            {pct(rate)}
            <Sub>goes to tax</Sub>
          </Stat>
          <Stat label="A $100 deduction">
            {formatDollars(rate * 100)}
            <Sub>saved</Sub>
          </Stat>
        </div>
        <p className="text-xs text-muted-foreground">
          A planning estimate, not tax advice: single filer, standard deduction, {formatDollars(wages)} a year of W-2
          wages from other jobs, 2026 federal and Oregon brackets, self-employment tax and the 20% business income
          deduction. It counts what the business adds on top of the wages, whose tax is already withheld. If the
          business owes $1,000 or more for the year, the IRS expects quarterly estimated payments.
        </p>
      </Card>

      <Card className="p-4 gap-3">
        <p className="text-sm font-medium text-foreground">For the CPA</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/finances/export?kind=mileage&year=${year}`}>
              <Download />
              Mileage log {year} (CSV)
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/finances/export?kind=expenses&year=${year}`}>
              <Download />
              Expenses {year} (CSV)
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/finances/export?kind=income&year=${year}`}>
              <Download />
              Income {year} (CSV)
            </a>
          </Button>
        </div>
      </Card>

      <FinanceSettingsForm mpg={r.settings.mpg} otherWagesMonthly={r.settings.otherWagesMonthly} />
    </div>
  );
}
