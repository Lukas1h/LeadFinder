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

function toNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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
  const [minScore, setMinScore] = useState(preset?.minScore?.toString() ?? "");
  const [maxScore, setMaxScore] = useState(preset?.maxScore?.toString() ?? "");
  const [minPrice, setMinPrice] = useState(preset?.minPrice?.toString() ?? "");
  const [maxPrice, setMaxPrice] = useState(preset?.maxPrice?.toString() ?? "");
  const [maxListingAgeDays, setMaxListingAgeDays] = useState(
    preset?.maxListingAgeDays?.toString() ?? ""
  );
  const [minPhotoCount, setMinPhotoCount] = useState(preset?.minPhotoCount?.toString() ?? "");
  const [maxPhotoCount, setMaxPhotoCount] = useState(preset?.maxPhotoCount?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!preset;
  const typeIsLocked = isEditing || !!defaultType;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const criteria = {
      minScore: toNumberOrNull(minScore),
      maxScore: toNumberOrNull(maxScore),
      minPrice: toNumberOrNull(minPrice),
      maxPrice: toNumberOrNull(maxPrice),
      maxListingAgeDays: toNumberOrNull(maxListingAgeDays),
      minPhotoCount: toNumberOrNull(minPhotoCount),
      maxPhotoCount: toNumberOrNull(maxPhotoCount),
    };

    const result = isEditing
      ? await updatePreset(preset.id, { name, ...criteria })
      : await createPreset({ name, type, ...criteria });

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

            <div className="flex flex-col gap-2 border-t pt-4">
              <Label className="text-xs text-muted-foreground font-normal">
                Recommend this preset for listings matching (leave blank for no constraint)
              </Label>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="min-score" className="text-xs">
                    Min photo score
                  </Label>
                  <Input
                    id="min-score"
                    type="number"
                    min={1}
                    max={10}
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value)}
                    placeholder="1"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="max-score" className="text-xs">
                    Max photo score
                  </Label>
                  <Input
                    id="max-score"
                    type="number"
                    min={1}
                    max={10}
                    value={maxScore}
                    onChange={(e) => setMaxScore(e.target.value)}
                    placeholder="10"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="min-price" className="text-xs">
                    Min price
                  </Label>
                  <Input
                    id="min-price"
                    type="number"
                    min={0}
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    placeholder="$"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="max-price" className="text-xs">
                    Max price
                  </Label>
                  <Input
                    id="max-price"
                    type="number"
                    min={0}
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    placeholder="$"
                  />
                </div>
                <div className="flex flex-col gap-1.5 col-span-2">
                  <Label htmlFor="max-age" className="text-xs">
                    Max listing age (days)
                  </Label>
                  <Input
                    id="max-age"
                    type="number"
                    min={0}
                    value={maxListingAgeDays}
                    onChange={(e) => setMaxListingAgeDays(e.target.value)}
                    placeholder="e.g. 3"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="min-photos" className="text-xs">
                    Min # of photos
                  </Label>
                  <Input
                    id="min-photos"
                    type="number"
                    min={0}
                    value={minPhotoCount}
                    onChange={(e) => setMinPhotoCount(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="max-photos" className="text-xs">
                    Max # of photos
                  </Label>
                  <Input
                    id="max-photos"
                    type="number"
                    min={0}
                    value={maxPhotoCount}
                    onChange={(e) => setMaxPhotoCount(e.target.value)}
                    placeholder="e.g. 5"
                  />
                </div>
              </div>
            </div>

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
