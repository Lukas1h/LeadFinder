"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Route, Trash2 } from "lucide-react";
import { deleteTrip, estimateTripRoute, getLinkOptions, saveTrip, type LinkOptions } from "./actions";
import { TRIP_CATEGORIES } from "@/lib/finance/categories";
import { pacificDate } from "@/lib/finance/math";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface TripDraft {
  id?: string;
  date: string;
  purpose: string;
  category: string;
  stops: string;
  miles: string;
  driveHours: string;
  milesEstimated: boolean;
  notes: string;
  bookingIds: string[];
}

export function blankTrip(overrides: Partial<TripDraft> = {}): TripDraft {
  return {
    date: pacificDate(new Date()),
    purpose: "",
    category: "shoot",
    stops: "",
    miles: "",
    driveHours: "",
    milesEstimated: false,
    notes: "",
    bookingIds: [],
    ...overrides,
  };
}

const hoursText = (minutes: number | null | undefined) =>
  minutes != null ? String(Math.round((minutes / 60) * 100) / 100) : "";

export function tripToDraft(t: {
  id: string;
  date: string;
  purpose: string;
  category: string;
  stops: string | null;
  miles: number;
  driveMinutes: number | null;
  milesEstimated: boolean;
  notes: string | null;
  bookingIds: string[];
}): TripDraft {
  return {
    id: t.id,
    date: t.date,
    purpose: t.purpose,
    category: t.category,
    stops: t.stops ?? "",
    miles: String(t.miles),
    driveHours: hoursText(t.driveMinutes),
    milesEstimated: t.milesEstimated,
    notes: t.notes ?? "",
    bookingIds: t.bookingIds,
  };
}

/**
 * Logs or edits a drive: one line of the mileage log. Miles can come from
 * "Estimate" (home, the stops, home, on real roads) and then be corrected.
 * Linking the jobs it was for is what splits its gas and drive time onto them.
 */
export function TripDialog({
  draft,
  open,
  onOpenChange,
}: {
  draft: TripDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [trip, setTrip] = useState(draft);
  const [options, setOptions] = useState<LinkOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "estimate" | "delete" | null>(null);

  // Reset to the draft each time it opens (not on every new draft object the parent renders).
  useEffect(() => {
    if (!open) return;
    setTrip(draft);
    setError(null);
    getLinkOptions().then(setOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (patch: Partial<TripDraft>) => setTrip((t) => ({ ...t, ...patch }));

  // Jobs within a few days of the trip first, then whatever's already linked.
  const nearbyBookings = (options?.bookings ?? []).filter((b) => {
    if (trip.bookingIds.includes(b.id)) return true;
    if (!b.date) return false;
    const days = Math.abs(new Date(b.date).getTime() - new Date(trip.date).getTime()) / 86400000;
    return days <= 4;
  });

  const handleEstimate = async () => {
    setBusy("estimate");
    setError(null);
    const result = await estimateTripRoute(trip.stops.split("\n"));
    setBusy(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    set({ miles: String(result.miles), driveHours: hoursText(result.driveMinutes), milesEstimated: true });
    if (result.approximate.length > 0) toast.message(`Routed to the town for: ${result.approximate.join("; ")}`);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("save");
    const driveHours = trip.driveHours.trim() ? Number(trip.driveHours) : null;
    const result = await saveTrip(trip.id ?? null, {
      date: trip.date,
      purpose: trip.purpose,
      category: trip.category,
      stops: trip.stops,
      miles: Number(trip.miles),
      driveMinutes: driveHours != null && Number.isFinite(driveHours) ? driveHours * 60 : null,
      milesEstimated: trip.milesEstimated,
      notes: trip.notes,
      bookingIds: trip.bookingIds,
    });
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    toast.success(trip.id ? "Trip updated" : "Trip logged");
    onOpenChange(false);
    router.refresh();
  };

  const handleDelete = async () => {
    if (!trip.id) return;
    setBusy("delete");
    await deleteTrip(trip.id);
    setBusy(null);
    toast.success("Trip deleted");
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>{trip.id ? "Edit trip" : "Log a trip"}</DialogTitle>
            <DialogDescription>A business drive: where, why and how far. Starts and ends at home.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="trip-date">Date</Label>
                <Input id="trip-date" type="date" value={trip.date} onChange={(e) => set({ date: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="trip-category">Kind</Label>
                <Select value={trip.category} onValueChange={(v) => set({ category: v })}>
                  <SelectTrigger id="trip-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIP_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trip-purpose">What it was for</Label>
              <Input
                id="trip-purpose"
                value={trip.purpose}
                onChange={(e) => set({ purpose: e.target.value })}
                placeholder="Shoot for January Finch, Klamath Falls"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trip-stops">Stops, one per line</Label>
              <Textarea
                id="trip-stops"
                rows={3}
                value={trip.stops}
                onChange={(e) => set({ stops: e.target.value })}
                placeholder={"111 Hunter Ct, Klamath Falls, OR\nGrants Pass, OR"}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={handleEstimate}
                disabled={busy != null || !trip.stops.trim()}
              >
                <Route />
                {busy === "estimate" ? "Finding the route…" : "Estimate miles from the route"}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="trip-miles">Miles, round trip</Label>
                <Input
                  id="trip-miles"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={trip.miles}
                  onChange={(e) => set({ miles: e.target.value, milesEstimated: false })}
                />
                {trip.milesEstimated && <span className="text-xs text-muted-foreground">From the route estimate</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="trip-hours">Drive time</Label>
                <Input
                  id="trip-hours"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={trip.driveHours}
                  onChange={(e) => set({ driveHours: e.target.value })}
                  placeholder="hrs"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Jobs it was for</Label>
              {nearbyBookings.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {options ? "No bookings within a few days of this date." : "Loading…"}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {nearbyBookings.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={trip.bookingIds.includes(b.id)}
                        onCheckedChange={(checked) =>
                          set({
                            bookingIds: checked
                              ? [...trip.bookingIds, b.id]
                              : trip.bookingIds.filter((id) => id !== b.id),
                          })
                        }
                      />
                      <span className="truncate">{b.label}</span>
                      {b.date && <span className="text-xs text-muted-foreground shrink-0">{b.date.slice(5)}</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trip-notes">Notes</Label>
              <Textarea id="trip-notes" rows={2} value={trip.notes} onChange={(e) => set({ notes: e.target.value })} />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="gap-2">
            {trip.id && (
              <Button type="button" variant="outline" onClick={handleDelete} disabled={busy != null} className="mr-auto">
                <Trash2 />
                Delete
              </Button>
            )}
            <Button type="submit" disabled={busy != null}>
              {busy === "save" ? "Saving…" : "Save trip"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
