"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, Check, RotateCcw, Pencil, Plus, X } from "lucide-react";
import { saveBookingShooter, markShooterPaid, getShooters } from "./shooterActions";
import { stageIndex } from "@/lib/bookingStages";
import { formatPrice } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BookingWithDetails } from "./BookedList";

/** "2026-11-20" → "Nov 20" without a timezone shift. */
function shortDay(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Who shoots this job when it isn't Lukas (a subcontracted photographer),
 * what they're paid, and whether that pay has been logged as an expense.
 */
export function ShooterSection({ booking }: { booking: BookingWithDetails }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const shooter = booking.shooter;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(shooter?.name ?? "");
  const [pay, setPay] = useState(shooter?.pay != null ? String(shooter.pay) : "");
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);

  const shot = stageIndex(booking.stage) >= stageIndex("editing");
  const paid = shooter?.expenseId != null;
  const listId = `shooters-${booking.id}`;

  const startEdit = () => {
    setName(shooter?.name ?? "");
    setPay(shooter?.pay != null ? String(shooter.pay) : "");
    setEditing(true);
    getShooters().then(setSuggestions).catch(() => {});
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
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Enter a name");
    const n = pay.trim() === "" ? null : Math.round(Number(pay));
    if (n != null && (!Number.isFinite(n) || n < 0)) return toast.error("Pay must be a dollar amount");
    act(() => saveBookingShooter(booking.id, { name: trimmed, pay: n }), "Shooter saved", () => setEditing(false));
  };

  if (editing) {
    return (
      <div className="border-t pt-3">
        <p className="text-xs text-muted-foreground mb-1.5">Shooter</p>
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
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={pay}
              onChange={(e) => setPay(e.target.value)}
              placeholder="Pay"
              className="h-8 w-24 pl-5"
            />
          </div>
          <Button type="submit" size="sm" disabled={isPending}>
            <Check />
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {shooter && !paid && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={isPending}
              onClick={() => act(() => saveBookingShooter(booking.id, null), "Shooter removed", () => setEditing(false))}
            >
              <X />
              Remove
            </Button>
          )}
        </form>
      </div>
    );
  }

  if (!shooter) {
    return (
      <div className="border-t pt-2">
        <button
          type="button"
          onClick={startEdit}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <Plus className="size-3.5" />
          Add shooter
        </button>
      </div>
    );
  }

  const payLabel = shooter.pay != null ? formatPrice(shooter.pay) : null;

  return (
    <div className="border-t pt-3">
      <p className="text-xs text-muted-foreground mb-1.5">Shooter</p>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm flex items-center gap-1.5 flex-wrap">
          <Users className="size-3.5 text-muted-foreground" />
          <span className="text-foreground">{shooter.name}</span>
          {payLabel && <span className="text-muted-foreground">· {payLabel}</span>}
          {paid ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              Paid{shooter.paidAt ? ` ${shortDay(shooter.paidAt)}` : ""}
            </span>
          ) : shot ? (
            payLabel && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                Owed {payLabel}
              </span>
            )
          ) : (
            <span className="text-xs text-muted-foreground">not shot yet</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {shot && !paid && shooter.pay != null && (
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => act(() => markShooterPaid(booking.id, true), `Logged ${payLabel} to ${shooter.name}`)}
            >
              <Check />
              Paid {shooter.name}
            </Button>
          )}
          {paid && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => act(() => markShooterPaid(booking.id, false), "Marked unpaid")}
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
