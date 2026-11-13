"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getBookingHighlightPhotos, setBookingHighlightPhotos } from "./actions";
import type { BookingWithDetails } from "./BookedList";

const MAX = 10;

/**
 * "Highlight photos": pick which delivered photos (and in what order) this
 * job's "Recent listings" card shows on agent pages and the main website.
 * Tap to add, tap again to remove; the number is the order. None picked =
 * the automatic even spread across the gallery (lib/listingCardPhotos.ts).
 */
export function HighlightPhotosButton({ booking }: { booking: BookingWithDetails }) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [shown, setShown] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();
  if (!booking.dropboxFolderLink) return null;

  const openPicker = () => {
    setOpen(true);
    setError(null);
    startLoad(async () => {
      const result = await getBookingHighlightPhotos(booking.id);
      if ("error" in result) {
        setError(result.error);
        setPhotos([]);
        return;
      }
      setPhotos(result.photos);
      setPicked(result.picked.filter((n) => result.photos.includes(n)));
      setShown(result.shown);
    });
  };

  const toggle = (name: string) =>
    setPicked((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : cur.length >= MAX ? cur : [...cur, name]));

  const save = (names: string[]) =>
    startSave(async () => {
      await setBookingHighlightPhotos(booking.id, names);
      toast.success(names.length ? `${names.length} highlight photo${names.length === 1 ? "" : "s"} saved` : "Back to automatic photos");
      setOpen(false);
    });

  return (
    <>
      <Button variant="outline" size="sm" onClick={openPicker}>
        <Star />
        Highlight photos
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Highlight photos</DialogTitle>
            <DialogDescription>
              The photos this job&apos;s card shows on agent pages and your website, in the order you tap them (up to {MAX}). None
              picked = spread evenly across the gallery.
            </DialogDescription>
          </DialogHeader>
          {loading || photos === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading photos…</p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-destructive">{error}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((name) => {
                const order = picked.indexOf(name);
                const auto = picked.length === 0 && shown.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggle(name)}
                    className={`relative aspect-[3/2] overflow-hidden rounded-md border-2 ${order >= 0 ? "border-primary" : "border-transparent"}`}
                    title={name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail from Dropbox */}
                    <img
                      src={`/api/bookings/${booking.id}/photo?name=${encodeURIComponent(name)}`}
                      alt={name}
                      loading="lazy"
                      className={`size-full object-cover ${order < 0 && picked.length > 0 ? "opacity-60" : ""}`}
                    />
                    {order >= 0 && (
                      <span className="absolute top-1 left-1 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                        {order + 1}
                      </span>
                    )}
                    {auto && (
                      <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">shown now</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" size="sm" onClick={() => save([])} disabled={saving || loading}>
              Use automatic
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => save(picked)} disabled={saving || loading || !!error}>
                {saving ? "Saving…" : `Save${picked.length ? ` ${picked.length}` : ""}`}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
