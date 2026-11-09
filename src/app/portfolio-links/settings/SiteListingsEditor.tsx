"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PortfolioListing } from "@/db/schema";
import { saveSiteListings } from "../actions";
import { JobSearch } from "../new/PortfolioLinkBuilder";

/** Which jobs the main website's "Recent listings" shows; starts from what it shows now. */
export function SiteListingsEditor({ listings: initial, picked }: { listings: PortfolioListing[]; picked: boolean }) {
  const router = useRouter();
  const [listings, setListings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = listings.map((l) => l.bookingId).join() !== initial.map((l) => l.bookingId).join();

  const move = (i: number, dir: number) =>
    setListings((prev) => {
      const next = [...prev];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });

  const save = async (ids: string[]) => {
    setSaving(true);
    try {
      await saveSiteListings(ids);
      toast.success("Website listings saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {!picked && <p className="text-xs text-muted-foreground">None picked, so it shows your three newest finished jobs.</p>}
      {listings.map((l, i) => (
        <div key={l.bookingId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
          <span className="truncate">
            {l.address || "No address"} <span className="text-muted-foreground">{l.city}</span>
            {l.status && <span className="ml-2 text-xs text-muted-foreground">· {l.status}</span>}
          </span>
          <div className="flex shrink-0">
            <Button variant="ghost" size="icon" className="size-7" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Move down"
              disabled={i === listings.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Remove listing"
              onClick={() => setListings((prev) => prev.filter((x) => x.bookingId !== l.bookingId))}
            >
              <X />
            </Button>
          </div>
        </div>
      ))}
      <JobSearch exclude={listings.map((l) => l.bookingId)} onPick={(job) => setListings((prev) => [...prev, job])} />
      <div className="mt-2 flex gap-2">
        <Button onClick={() => save(listings.map((l) => l.bookingId))} disabled={saving || (!dirty && picked)}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
        {picked && (
          <Button variant="ghost" onClick={() => save([])} disabled={saving}>
            Use newest three
          </Button>
        )}
      </div>
    </div>
  );
}
