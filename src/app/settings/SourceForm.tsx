"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { SearchSource } from "@/db/schema";
import { createSource, updateSource, type SourceInput } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

const HOME_TYPES = [
  { value: "house", label: "House" },
  { value: "condo", label: "Condo" },
  { value: "townhouse", label: "Townhouse" },
  { value: "multi_family", label: "Multi-family" },
  { value: "manufactured", label: "Manufactured" },
  { value: "lot", label: "Lot / land" },
  { value: "apartment", label: "Apartment" },
];

function parseHomeTypes(value: string | null): Set<string> {
  return new Set(value ? value.split(",") : []);
}

export function SourceForm({
  source,
  trigger,
}: {
  source?: SearchSource;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState(source?.name ?? "");
  const [bbox, setBbox] = useState(source?.bbox ?? "");
  const [priceMin, setPriceMin] = useState(source?.priceMin?.toString() ?? "");
  const [priceMax, setPriceMax] = useState(source?.priceMax?.toString() ?? "");
  const [homeTypes, setHomeTypes] = useState<Set<string>>(parseHomeTypes(source?.homeTypes ?? null));
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!source;

  const toggleHomeType = (value: string) => {
    setHomeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const input: SourceInput = {
      name: name.trim() || "Untitled",
      bbox: bbox.trim(),
      priceMin: priceMin.trim() ? Number(priceMin) : null,
      priceMax: priceMax.trim() ? Number(priceMax) : null,
      homeTypes: homeTypes.size > 0 ? Array.from(homeTypes).join(",") : null,
    };

    const result = isEditing ? await updateSource(source.id, input) : await createSource(input);

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    toast.success(isEditing ? "Source updated" : "Source added");
    setOpen(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit source" : "Add search source"}</DialogTitle>
            <DialogDescription>
              Each source is its own bbox and filters, fetched independently on every sync.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="source-name">Name</Label>
              <Input
                id="source-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Eugene"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="source-bbox">Bbox (west,south,east,north)</Label>
              <Input
                id="source-bbox"
                value={bbox}
                onChange={(e) => setBbox(e.target.value)}
                placeholder="-123.588360,43.640017,-122.616083,44.349571"
                required
                className="font-mono text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="source-price-min">Min price</Label>
                <Input
                  id="source-price-min"
                  type="number"
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="source-price-max">Max price</Label>
                <Input
                  id="source-price-max"
                  type="number"
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Home types (none = all)</Label>
              <div className="grid grid-cols-2 gap-2">
                {HOME_TYPES.map((type) => (
                  <label key={type.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={homeTypes.has(type.value)}
                      onCheckedChange={() => toggleHomeType(type.value)}
                    />
                    {type.label}
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Add source"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
