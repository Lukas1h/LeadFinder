"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Plus, Archive, ArchiveRestore } from "lucide-react";
import type { MessagePreset, MessagePresetVariant } from "@/db/schema";
import type { VariantStats } from "@/lib/messageStats";
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

function formatCriteria(preset: MessagePreset): string | null {
  const parts: string[] = [];
  if (preset.minScore != null || preset.maxScore != null) {
    parts.push(`score ${preset.minScore ?? 1}–${preset.maxScore ?? 10}`);
  }
  if (preset.minPrice != null || preset.maxPrice != null) {
    const min = preset.minPrice != null ? `$${preset.minPrice.toLocaleString()}` : "$0";
    const max = preset.maxPrice != null ? `$${preset.maxPrice.toLocaleString()}` : "+";
    parts.push(`price ${min}–${max}`);
  }
  if (preset.maxListingAgeDays != null) {
    parts.push(`≤${preset.maxListingAgeDays}d old`);
  }
  if (preset.minPhotoCount != null || preset.maxPhotoCount != null) {
    parts.push(`${preset.minPhotoCount ?? 0}–${preset.maxPhotoCount ?? "∞"} photos`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function rate(n: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((n / total) * 100)}%`;
}

function AgentBucketLine({
  label,
  bucket,
}: {
  label: string;
  bucket: { sent: number; booked: number };
}) {
  if (bucket.sent === 0) return null;
  return (
    <p>
      {label}: {bucket.sent} sent, {rate(bucket.booked, bucket.sent)} booked
    </p>
  );
}

function VariantRow({
  variant,
  stats,
}: {
  variant: MessagePresetVariant;
  stats: VariantStats;
}) {
  const [isPending, startTransition] = useTransition();

  const handleArchive = () => {
    startTransition(async () => {
      await toggleVariant(variant.id, false);
      toast.success(`Archived "${variant.label}"`);
    });
  };

  const handleRestore = () => {
    startTransition(() => toggleVariant(variant.id, true));
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
    <div className="border-t border-border/70 py-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{variant.label}</span>
            {!variant.enabled && (
              <span className="text-xs text-muted-foreground">(archived)</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">
            {variant.body}
          </p>

          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="secondary">{stats.sent} sent</Badge>
            <Badge variant="secondary">{rate(stats.responded, stats.sent)} responded</Badge>
            <Badge variant="secondary">{rate(stats.booked, stats.sent)} booked</Badge>
          </div>

          {stats.sent > 0 && (
            <details className="mt-2 group/stats">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none w-fit">
                More stats
              </summary>
              <div className="text-xs text-muted-foreground mt-1.5 flex flex-col gap-0.5">
                <p>
                  {stats.quoted} quoted · {stats.declined} declined ({rate(stats.declined, stats.sent)})
                </p>
                {stats.revenue > 0 && <p>${stats.revenue.toLocaleString()} total booked</p>}
                <AgentBucketLine label="New agents" bucket={stats.newAgent} />
                <AgentBucketLine label="Repeat agents" bucket={stats.repeatAgent} />
              </div>
            </details>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
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

          {!variant.enabled ? (
            <Button variant="ghost" size="icon" onClick={handleRestore} disabled={isPending}>
              <ArchiveRestore />
              <span className="sr-only">Restore variant</span>
            </Button>
          ) : stats.sent > 0 ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground">
                  <Archive />
                  <span className="sr-only">Archive variant</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive &ldquo;{variant.label}&rdquo;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It has send history, so it can&rsquo;t be deleted. Archiving stops it from being
                    picked for future sends but keeps its stats.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleArchive}>Archive</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
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
                    It hasn&rsquo;t been sent yet — deleting it is safe.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
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

  const emptyStats: VariantStats = {
    sent: 0,
    responded: 0,
    quoted: 0,
    booked: 0,
    declined: 0,
    revenue: 0,
    newAgent: { sent: 0, booked: 0 },
    repeatAgent: { sent: 0, booked: 0 },
  };
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
          {formatCriteria(preset) && (
            <p className="text-xs text-muted-foreground/80 mt-0.5">
              Recommended for: {formatCriteria(preset)}
            </p>
          )}
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

      <div className="bg-muted/30 rounded-lg border-l-2 border-border pl-3 pr-2 py-1">
        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground/70 py-2">No variants yet.</p>
        ) : (
          variants.map((variant) => (
            <VariantRow key={variant.id} variant={variant} stats={statsByVariant[variant.id] ?? emptyStats} />
          ))
        )}
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
