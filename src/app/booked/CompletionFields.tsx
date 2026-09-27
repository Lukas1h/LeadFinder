"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COMPLETION_FIELDS, type CompletionDraft } from "./bookingMath";

/** The hours/costs inputs shared by CompleteBookingDialog and BookingForm's edit mode. */
export function CompletionFields({
  value,
  onChange,
}: {
  value: CompletionDraft;
  onChange: (next: CompletionDraft) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {COMPLETION_FIELDS.map(({ key, label, unit }) => (
        <div key={key} className="flex flex-col gap-1.5">
          <Label htmlFor={`completion-${key}`}>{label}</Label>
          <Input
            id={`completion-${key}`}
            type="number"
            min="0"
            step={unit === "hours" ? "any" : "1"}
            inputMode="decimal"
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            placeholder={unit === "hours" ? "hrs" : "$"}
          />
        </div>
      ))}
    </div>
  );
}
