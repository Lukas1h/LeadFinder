import { PF_ACCOUNTS, type PfPeriod, type ProfitFirstPercents } from "@/lib/finance/profitFirst";
import { formatDollars } from "@/lib/finance/format";

/** The four accounts' dollars for a period, each with its percent. */
export function Allocations({ period, percents }: { period: PfPeriod; percents: ProfitFirstPercents }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {PF_ACCOUNTS.map(({ key, label }) => (
        <div key={key} className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">
            {label} · {percents[key]}%
          </span>
          <span className="text-lg font-semibold text-foreground">{formatDollars(period.allocations[key])}</span>
        </div>
      ))}
    </div>
  );
}

/** OpEx spent against the OpEx share: the bar fills with spending, red once it's over. */
export function OpexBar({ period }: { period: PfPeriod }) {
  const allotted = period.allocations.opex;
  const over = period.opexLeft < 0;
  const fill = allotted > 0 ? Math.min(1, period.opexSpent / allotted) : period.opexSpent > 0 ? 1 : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">
          OpEx spent {formatDollars(period.opexSpent)} of {formatDollars(allotted)}
        </span>
        <span className={over ? "font-medium text-destructive" : "text-foreground"}>
          {over ? `${formatDollars(-period.opexLeft)} over` : `${formatDollars(period.opexLeft)} left`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-destructive" : "bg-foreground/70"}`}
          style={{ width: `${fill * 100}%` }}
        />
      </div>
    </div>
  );
}
