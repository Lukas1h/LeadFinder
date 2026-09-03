"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Plus } from "lucide-react";
import type { MessagePreset, MessagePresetVariant } from "@/db/schema";
import { deletePreset, togglePreset, deleteVariant, toggleVariant } from "./actions";
import { PresetForm } from "./PresetForm";
import { VariantForm } from "./VariantForm";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

export interface VariantStats {
  sent: number;
  responded: number;
  declined: number;
}

function rate(n: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((n / total) * 100)}%`;
}

function VariantRow({
  variant,
  stats,
}: {
  variant: MessagePresetVariant;
  stats: VariantStats;
}) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = (checked: boolean) => {
    startTransition(() => toggleVariant(variant.id, checked));
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteVariant(variant.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted "${variant.label}"`);
    });
  };

  return (
    <div className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{variant.label}</span>
            {!variant.enabled && <span className="text-xs text-muted-foreground">(disabled)</span>}
          </div>
          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">
            {variant.body}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            <Badge variant="secondary">{stats.sent} sent</Badge>
            <Badge variant="secondary">
              {stats.responded} responded ({rate(stats.responded, stats.sent)})
            </Badge>
            <Badge variant="secondary">
              {stats.declined} declined ({rate(stats.declined, stats.sent)})
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Switch checked={variant.enabled} onCheckedChange={handleToggle} disabled={isPending} />
          <VariantForm
            presetId={variant.presetId}
            variant={variant}
            trigger={
              <Button variant="ghost" size="icon">
                <Pencil />
                <span className="sr-only">Edit variant</span>
              </Button>
            }
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground">
                <Trash2 />
                <span className="sr-only">Delete variant</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &ldquo;{variant.label}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  {stats.sent > 0
                    ? "This variant has send history — deleting will be rejected. Disable it instead to stop using it while keeping its stats."
                    : "This variant hasn't been sent yet — deleting it is safe."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

export function PresetCard({
  preset,
  variants,
  statsByVariant,
}: {
  preset: MessagePreset;
  variants: MessagePresetVariant[];
  statsByVariant: Record<string, VariantStats>;
}) {
  const [isPending, startTransition] = useTransition();

  const totalSent = variants.reduce((sum, v) => sum + (statsByVariant[v.id]?.sent ?? 0), 0);

  const handleToggle = (checked: boolean) => {
    startTransition(() => togglePreset(preset.id, checked));
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deletePreset(preset.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted ${preset.name}`);
    });
  };

  return (
    <Card className="p-4 gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground">{preset.name}</h3>
            {!preset.enabled && <span className="text-xs text-muted-foreground">(disabled)</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {variants.length} variant{variants.length === 1 ? "" : "s"} · {totalSent} sent total
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Switch checked={preset.enabled} onCheckedChange={handleToggle} disabled={isPending} />
          <PresetForm
            preset={preset}
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
                <AlertDialogTitle>Delete &ldquo;{preset.name}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  {totalSent > 0
                    ? "This preset has send history — deleting will be rejected. Disable it instead."
                    : "This preset hasn't been sent yet — deleting it is safe."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div>
        {variants.map((variant) => (
          <VariantRow
            key={variant.id}
            variant={variant}
            stats={statsByVariant[variant.id] ?? { sent: 0, responded: 0, declined: 0 }}
          />
        ))}
      </div>

      <VariantForm
        presetId={preset.id}
        trigger={
          <Button variant="outline" size="sm" className="self-start">
            <Plus />
            Add variant
          </Button>
        }
      />
    </Card>
  );
}
