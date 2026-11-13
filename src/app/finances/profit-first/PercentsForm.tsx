"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PF_ACCOUNTS, type PfAccount, type ProfitFirstPercents } from "@/lib/finance/profitFirst";
import { saveProfitFirstPercents } from "../actions";

/** The four Profit First percentages; they have to add up to 100. */
export function PercentsForm({ percents }: { percents: ProfitFirstPercents }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<PfAccount, string>>(
    () => Object.fromEntries(PF_ACCOUNTS.map(({ key }) => [key, String(percents[key])])) as Record<PfAccount, string>,
  );
  const [saving, setSaving] = useState(false);

  const values = Object.fromEntries(PF_ACCOUNTS.map(({ key }) => [key, Number(draft[key]) || 0])) as ProfitFirstPercents;
  const total = PF_ACCOUNTS.reduce((sum, { key }) => sum + values[key], 0);
  const valid = total === 100;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    const result = await saveProfitFirstPercents(values);
    setSaving(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Percentages saved");
    router.refresh();
  };

  return (
    <Card className="p-4 gap-3">
      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Percentages</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Profit First: every dollar that comes in is split into these accounts first, and the business runs on
            what&rsquo;s left in OpEx.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PF_ACCOUNTS.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`pf-${key}`}>{label}</Label>
              <div className="relative">
                <Input
                  id={`pf-${key}`}
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  inputMode="numeric"
                  className="pr-7"
                  value={draft[key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={saving || !valid}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <span className={`text-xs ${valid ? "text-muted-foreground" : "font-medium text-destructive"}`}>
            Total {total}%{valid ? "" : ` — needs to be 100% (${total > 100 ? `${total - 100} over` : `${100 - total} short`})`}
          </span>
        </div>
      </form>
    </Card>
  );
}
