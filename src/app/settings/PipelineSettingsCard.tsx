"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Timer } from "lucide-react";
import { updateFollowUpAfterDays } from "./actions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PipelineSettingsCard({ followUpAfterDays }: { followUpAfterDays: number }) {
  const [value, setValue] = useState(String(followUpAfterDays));
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    const days = Number(value);
    startTransition(async () => {
      const result = await updateFollowUpAfterDays(days);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Follow-up time updated");
    });
  };

  const dirty = value !== String(followUpAfterDays);

  return (
    <Card className="p-4 mb-8 gap-3">
      <div className="flex items-center gap-2">
        <Timer className="size-4 text-muted-foreground" />
        <h2 className="font-semibold text-foreground text-sm">Pipeline</h2>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="follow-up-days">Flag for follow-up after</Label>
          <div className="flex items-center gap-2">
            <Input
              id="follow-up-days"
              type="number"
              min="1"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">days without a reply</span>
          </div>
        </div>
        <Button onClick={handleSave} disabled={isPending || !dirty}>
          Save
        </Button>
      </div>
    </Card>
  );
}
