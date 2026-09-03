"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { MessagePreset, PresetType } from "@/db/schema";
import { createPreset, updatePreset } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TYPE_OPTIONS: { value: PresetType; label: string }[] = [
  { value: "initial_outreach", label: "Initial Outreach" },
  { value: "follow_up", label: "Follow-up" },
];

export function PresetForm({
  preset,
  defaultType,
  trigger,
}: {
  preset?: MessagePreset;
  defaultType?: PresetType;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState(preset?.name ?? "");
  const [type, setType] = useState<PresetType>(preset?.type ?? defaultType ?? "initial_outreach");
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!preset;
  const typeIsLocked = isEditing || !!defaultType;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = isEditing
      ? await updatePreset(preset.id, { name })
      : await createPreset({ name, type });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    toast.success(isEditing ? "Preset updated" : "Preset created");
    setOpen(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit preset" : "New preset"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Renaming doesn't affect its send history or variants."
                : "Give it a name you'll recognize later — you'll add 2-3 variants to A/B test next."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="preset-name">Name</Label>
              <Input
                id="preset-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Quick Turnaround Pitch"
                required
              />
            </div>

            {!typeIsLocked && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="preset-type">Used for</Label>
                <Select value={type} onValueChange={(v) => setType(v as PresetType)}>
                  <SelectTrigger id="preset-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Create preset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
