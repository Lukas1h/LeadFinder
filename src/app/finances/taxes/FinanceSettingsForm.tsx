"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveFinanceSettings } from "../actions";

/** The two numbers the math leans on: the car's MPG, and what the other jobs pay. */
export function FinanceSettingsForm({ mpg, otherWagesMonthly }: { mpg: number; otherWagesMonthly: number }) {
  const router = useRouter();
  const [mpgText, setMpgText] = useState(String(mpg));
  const [wagesText, setWagesText] = useState(String(otherWagesMonthly));
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const result = await saveFinanceSettings({ mpg: Number(mpgText), otherWagesMonthly: Number(wagesText) });
    setSaving(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Saved");
    router.refresh();
  };

  return (
    <Card className="p-4 gap-3">
      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <p className="text-sm font-medium text-foreground">Settings</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="finance-mpg">Car&rsquo;s average MPG</Label>
            <Input id="finance-mpg" type="number" min="1" step="any" inputMode="decimal" value={mpgText} onChange={(e) => setMpgText(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="finance-wages">Other jobs&rsquo; pay a month</Label>
            <Input id="finance-wages" type="number" min="0" step="1" inputMode="numeric" value={wagesText} onChange={(e) => setWagesText(e.target.value)} placeholder="$" />
          </div>
        </div>
        <Button type="submit" size="sm" className="self-start" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </Card>
  );
}
