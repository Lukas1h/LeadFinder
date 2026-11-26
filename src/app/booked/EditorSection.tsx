"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wand2, Check, RotateCcw, Pencil, Plus } from "lucide-react";
import { saveBookingEditor, markEditorPaid, getEditors } from "./shooterActions";
import { formatPrice } from "@/lib/format";
import { HDR_EDITOR_COST } from "@/lib/markets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BookingWithDetails } from "./BookedList";

/** "2026-11-20" → "Nov 20" without a timezone shift. */
function shortDay(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The photo editor on a contracted job — same look and flow as the shooter:
 * name, cost (recorded or the style default), Owed/Paid, and a Paid button
 * that logs the Subcontractors expense.
 */
export function EditorSection({ booking, shot }: { booking: BookingWithDetails; shot: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const shooter = booking.shooter;
  const costInit = shooter && !shooter.editorCostIsDefault ? String(shooter.editorCost) : "";
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(shooter?.editorName ?? "");
  const [cost, setCost] = useState(costInit);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  if (!shooter) return null;

  const paid = shooter.editorExpenseId != null;
  const listId = `editors-${booking.id}`;
  const defaultCost = shooter.editorCostIsDefault ? shooter.editorCost : shooter.style === "flambient" ? 0 : HDR_EDITOR_COST;

  const startEdit = () => {
    setName(shooter.editorName ?? "");
    setCost(costInit);
    setEditing(true);
    getEditors().then(setSuggestions).catch(() => {});
  };

  const act = (fn: () => Promise<{ error?: string }>, done: string, after?: () => void) => {
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(done);
      after?.();
      router.refresh();
    });
  };

  const save = () => {
    const n = cost.trim() === "" ? null : Math.round(Number(cost));
    if (n != null && (!Number.isFinite(n) || n < 0)) return toast.error("Cost must be a dollar amount");
    act(
      () => saveBookingEditor(booking.id, { name: name.trim() || null, cost: n }),
      "Editor saved",
      () => setEditing(false)
    );
  };

  if (editing) {
    return (
      <div className="border-t pt-3">
        <p className="text-xs text-muted-foreground mb-1.5">Editor</p>
        <form
          className="flex items-center gap-2 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            list={listId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="h-8 w-36"
            autoFocus
          />
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder={`${defaultCost} default`}
              title="Photo editor cost — blank uses the default"
              className="h-8 w-28 pl-5"
            />
          </div>
          <Button type="submit" size="sm" disabled={isPending}>
            <Check />
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      </div>
    );
  }

  const hidden =
    shooter.style === "flambient" && shooter.editorCost === 0 && shooter.editorCostIsDefault && !shooter.editorName;
  if (hidden) {
    return (
      <div className="border-t pt-2">
        <button
          type="button"
          onClick={startEdit}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <Plus className="size-3.5" />
          Add editor
        </button>
      </div>
    );
  }

  const label = shooter.editorName ?? "Photo editor";
  const costLabel = formatPrice(shooter.editorCost);

  return (
    <div className="border-t pt-3">
      <p className="text-xs text-muted-foreground mb-1.5">Editor</p>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm flex items-center gap-1.5 flex-wrap">
          <Wand2 className="size-3.5 text-muted-foreground" />
          <span className="text-foreground">{label}</span>
          <span className="text-muted-foreground">
            · {costLabel}
            {shooter.editorCostIsDefault && <span className="text-xs opacity-70"> default</span>}
          </span>
          {paid ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              Paid{shooter.editorPaidAt ? ` ${shortDay(shooter.editorPaidAt)}` : ""}
            </span>
          ) : shot ? (
            shooter.editorCost > 0 && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                Owed {costLabel}
              </span>
            )
          ) : (
            <span className="text-xs text-muted-foreground">not shot yet</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {shot && !paid && shooter.editorCost > 0 && (
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => act(() => markEditorPaid(booking.id, true), `Logged ${costLabel} to ${label}`)}
            >
              <Check />
              Paid {label}
            </Button>
          )}
          {paid && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => act(() => markEditorPaid(booking.id, false), "Marked unpaid")}
            >
              <RotateCcw />
              Mark unpaid
            </Button>
          )}
          {!paid && (
            <Button variant="ghost" size="sm" disabled={isPending} onClick={startEdit}>
              <Pencil />
              Edit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
