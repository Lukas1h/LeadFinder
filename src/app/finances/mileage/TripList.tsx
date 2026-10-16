"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Stat, Sub } from "../../Stat";
import { TripDialog, blankTrip, tripToDraft, type TripDraft } from "../TripDialog";
import { tripCategoryLabel } from "@/lib/finance/categories";
import { dayLabel, formatDollars, formatMoney, monthLabel } from "@/lib/finance/format";

export interface TripRow {
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
  gas: number;
  pricePerGallon: number;
  rate: number;
  deduction: number;
  jobLabels: string[];
}

/** The mileage log, by month. Tap a trip to edit it. */
export function TripList({ trips, year, mpg }: { trips: TripRow[]; year: string; mpg: number }) {
  const [draft, setDraft] = useState<TripDraft>(() => blankTrip());
  const [open, setOpen] = useState(false);

  const thisYear = trips.filter((t) => t.date.startsWith(`${year}-`));
  const months = useMemo(() => {
    const byMonth = new Map<string, TripRow[]>();
    for (const t of trips) byMonth.set(t.date.slice(0, 7), [...(byMonth.get(t.date.slice(0, 7)) ?? []), t]);
    return [...byMonth.entries()];
  }, [trips]);

  const edit = (d: TripDraft) => {
    setDraft(d);
    setOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4 gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">{year} mileage</p>
          <Button size="sm" onClick={() => edit(blankTrip())}>
            <Plus />
            Log trip
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Business miles">
            {Math.round(thisYear.reduce((s, t) => s + t.miles, 0)).toLocaleString()}
            <Sub>{thisYear.length} trips</Sub>
          </Stat>
          <Stat label="Mileage deduction">{formatDollars(thisYear.reduce((s, t) => s + t.deduction, 0))}</Stat>
          <Stat label="Gas it burned">
            {formatDollars(thisYear.reduce((s, t) => s + t.gas, 0))}
            <Sub>at {mpg} mpg</Sub>
          </Stat>
        </div>
      </Card>

      {months.map(([month, rows]) => (
        <div key={month} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-foreground">{monthLabel(month)}</span>
            <span className="text-muted-foreground">
              {Math.round(rows.reduce((s, t) => s + t.miles, 0))} mi · {formatDollars(rows.reduce((s, t) => s + t.deduction, 0))} deduction
            </span>
          </div>
          <Card className="p-0 gap-0">
            {rows.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => edit(tripToDraft(t))}
                className="flex items-center gap-3 px-4 py-2.5 text-left text-sm border-b last:border-0 hover:bg-muted/50"
              >
                <span className="w-12 shrink-0 text-muted-foreground">{dayLabel(t.date)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-foreground">{t.purpose}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {tripCategoryLabel(t.category)}
                    {t.driveMinutes ? ` · ${Math.round((t.driveMinutes / 60) * 10) / 10} h driving` : ""}
                    {t.jobLabels.length ? ` · ${t.jobLabels.join(" + ")}` : ""}
                  </span>
                </span>
                <span className="w-24 shrink-0 text-right">
                  <span className="block text-foreground">
                    {Math.round(t.miles)} mi{t.milesEstimated ? "*" : ""}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatMoney(t.gas)} gas · {formatDollars(t.deduction)}
                  </span>
                </span>
              </button>
            ))}
          </Card>
        </div>
      ))}
      <p className="text-xs text-muted-foreground -mt-2">
        * miles from the route estimate. Gas is the miles at {mpg} mpg and the price on the latest gas receipt before
        the trip. The deduction is the IRS rate for the trip&rsquo;s date (72.5¢ a mile through June 2026, 76¢ from July).
      </p>

      <TripDialog draft={draft} open={open} onOpenChange={setOpen} />
    </div>
  );
}
