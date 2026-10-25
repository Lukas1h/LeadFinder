"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteTownImage, saveTownImage, type TownImage } from "../actions";
import { ImageUpload } from "../new/PortfolioLinkBuilder";

export function TownImagesEditor({ images, suggestions }: { images: TownImage[]; suggestions: string[] }) {
  const router = useRouter();
  const [town, setTown] = useState("");
  const [src, setSrc] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (label: string, imageSrc: string | null) => {
    if (!imageSrc) return;
    setSaving(true);
    try {
      await saveTownImage(label, imageSrc);
      toast.success(`Saved ${label.trim()}`);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {images.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {images.map((img) => (
            <div key={img.town} className="flex flex-col gap-2 rounded-lg border p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded town photo */}
              <img src={img.imageSrc} alt={img.label} className="aspect-[1200/630] w-full rounded-md object-cover" />
              <div className="flex items-center justify-between">
                <span className="font-medium">{img.label}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await deleteTownImage(img.town);
                    router.refresh();
                  }}
                >
                  <Trash2 />
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <p className="text-sm font-medium">Add a town</p>
        <p className="-mt-2 text-xs text-muted-foreground">Saving a town that&apos;s already here replaces its photo. Previews crop to a wide 1200×630.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ImageUpload label="Town" value={src} onChange={setSrc} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="town-name">Town</Label>
            <Input id="town-name" value={town} onChange={(e) => setTown(e.target.value)} placeholder="Roseburg" list="town-suggestions" />
            <datalist id="town-suggestions">
              {suggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            {suggestions.length > 0 && (
              <p className="text-xs text-muted-foreground">Used by your links or agents, no photo yet: {suggestions.slice(0, 8).join(", ")}</p>
            )}
            <Button
              className="mt-auto self-start"
              disabled={saving || !src || !town.trim()}
              onClick={async () => {
                if (await save(town, src)) {
                  setTown("");
                  setSrc(null);
                }
              }}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save town
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
