"use client";

import { useMemo, useState } from "react";
import { Paperclip, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ExpenseDialog, blankExpense, type ExpenseDraft } from "../ExpenseDialog";
import { expenseCategory } from "@/lib/finance/categories";
import { dayLabel, formatMoney, monthLabel } from "@/lib/finance/format";

export interface ExpenseRow {
  id: string;
  date: string;
  amount: number;
  vendor: string | null;
  description: string;
  category: string;
  deductiblePercent: number;
  gallons: number | null;
  pricePerGallon: number | null;
  paidPersonally: boolean;
  spreadMonths: number;
  bookingId: string | null;
  tripId: string | null;
  receiptNumber: number | null;
  notes: string | null;
  hasReceipt: boolean;
}

function toDraft(e: ExpenseRow): ExpenseDraft {
  return {
    id: e.id,
    date: e.date,
    amount: e.amount.toFixed(2),
    vendor: e.vendor ?? "",
    description: e.description,
    category: e.category,
    deductiblePercent: e.deductiblePercent,
    gallons: e.gallons != null ? String(e.gallons) : "",
    pricePerGallon: e.pricePerGallon != null ? String(e.pricePerGallon) : "",
    paidPersonally: e.paidPersonally,
    yearly: e.spreadMonths > 1,
    bookingId: e.bookingId,
    tripId: e.tripId,
    notes: e.notes ?? "",
    hasReceipt: e.hasReceipt,
    receiptNumber: e.receiptNumber,
  };
}

/** Every expense by month, newest first. Tap one to edit it. */
export function ExpenseList({ expenses }: { expenses: ExpenseRow[] }) {
  const [draft, setDraft] = useState<ExpenseDraft>(() => blankExpense());
  const [open, setOpen] = useState(false);

  const months = useMemo(() => {
    const byMonth = new Map<string, ExpenseRow[]>();
    for (const e of expenses) byMonth.set(e.date.slice(0, 7), [...(byMonth.get(e.date.slice(0, 7)) ?? []), e]);
    return [...byMonth.entries()];
  }, [expenses]);

  const edit = (d: ExpenseDraft) => {
    setDraft(d);
    setOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {expenses.length} expenses · {formatMoney(expenses.reduce((s, e) => s + e.amount, 0))} all time
        </p>
        <Button size="sm" onClick={() => edit(blankExpense())}>
          <Plus />
          Add expense
        </Button>
      </div>

      {months.map(([month, rows]) => {
        const business = rows.filter((e) => e.category !== "personal");
        return (
          <div key={month} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-foreground">{monthLabel(month)}</span>
              <span className="text-muted-foreground">
                {formatMoney(business.reduce((s, e) => s + e.amount, 0))} ·{" "}
                {formatMoney(rows.reduce((s, e) => s + (e.amount * e.deductiblePercent) / 100, 0))} deductible
              </span>
            </div>
            <Card className="p-0 gap-0">
              {rows.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => edit(toDraft(e))}
                  className="flex items-center gap-3 px-4 py-2.5 text-left text-sm border-b last:border-0 hover:bg-muted/50"
                >
                  <span className="w-12 shrink-0 text-muted-foreground">{dayLabel(e.date)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-foreground">{e.description}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {expenseCategory(e.category).label}
                      {e.vendor ? ` · ${e.vendor}` : ""}
                      {e.spreadMonths > 1 ? " · yearly" : ""}
                      {e.paidPersonally ? " · personal card" : ""}
                    </span>
                  </span>
                  {e.hasReceipt && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className="w-20 shrink-0 text-right">
                    <span className="block text-foreground">{formatMoney(e.amount)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {e.deductiblePercent === 100 ? "deductible" : e.deductiblePercent === 0 ? "not deductible" : `${e.deductiblePercent}% deductible`}
                    </span>
                  </span>
                </button>
              ))}
            </Card>
          </div>
        );
      })}

      <ExpenseDialog draft={draft} open={open} onOpenChange={setOpen} />
    </div>
  );
}
