"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, MapPin } from "lucide-react";
import type { SearchSource } from "@/db/schema";
import { deleteSource, toggleSource } from "./actions";
import { SourceForm } from "./SourceForm";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const HOME_TYPE_LABELS: Record<string, string> = {
  house: "House",
  condo: "Condo",
  townhouse: "Townhouse",
  multi_family: "Multi-family",
  manufactured: "Manufactured",
  lot: "Lot / land",
  apartment: "Apartment",
};

function formatPriceRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `$${min.toLocaleString()} – $${max.toLocaleString()}`;
  if (min != null) return `$${min.toLocaleString()}+`;
  return `Up to $${max!.toLocaleString()}`;
}

export function SourceCard({ source }: { source: SearchSource }) {
  const [isPending, startTransition] = useTransition();

  const priceRange = formatPriceRange(source.priceMin, source.priceMax);
  const homeTypes = source.homeTypes
    ?.split(",")
    .map((t) => HOME_TYPE_LABELS[t] ?? t)
    .join(", ");

  const handleDelete = () => {
    startTransition(async () => {
      await deleteSource(source.id);
      toast.success(`Deleted ${source.name}`);
    });
  };

  const handleToggle = (checked: boolean) => {
    startTransition(() => toggleSource(source.id, checked));
  };

  return (
    <Card className="flex-row items-start justify-between gap-4 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-muted-foreground shrink-0" />
          <h3 className="font-semibold text-foreground">{source.name}</h3>
          {!source.enabled && <span className="text-xs text-muted-foreground">(disabled)</span>}
        </div>
        <p className="text-xs text-muted-foreground font-mono mt-1">{source.bbox}</p>
        <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-3">
          {priceRange && <span>{priceRange}</span>}
          {homeTypes && <span>{homeTypes}</span>}
          {!priceRange && !homeTypes && <span>No filters</span>}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Switch checked={source.enabled} onCheckedChange={handleToggle} disabled={isPending} />
        <SourceForm
          source={source}
          trigger={
            <Button variant="ghost" size="icon">
              <Pencil />
              <span className="sr-only">Edit</span>
            </Button>
          }
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <Trash2 />
              <span className="sr-only">Delete</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{source.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                This only stops future syncs from searching this area — leads you&rsquo;ve already
                found stay right where they are.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Card>
  );
}
