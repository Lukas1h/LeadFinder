"use client";

import { useState } from "react";
import type { Listing } from "@/db/schema";
import { formatPrice, formatDate } from "@/lib/format";
import { StatusBadge } from "./badges";
import { ListingModal } from "./ListingModal";

/**
 * Compact clickable row for referencing a listing from elsewhere (an
 * agent's detail dialog, a booking's detail dialog) — thumbnail, address,
 * price/date, status badge, opens the full ListingModal on click. Shared
 * so every "here's the listing this thing is about" reference looks and
 * behaves the same.
 */
export function ListingRow({ listing }: { listing: Listing }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 w-full text-left rounded-lg p-2 hover:bg-muted/50"
      >
        <div className="size-12 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
          {listing.photos && listing.photos.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={listing.photos[0]} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[9px] text-muted-foreground text-center px-1">No photo</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {listing.address ?? "Unknown address"}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatPrice(listing.price)} · {formatDate(listing.listedAt)}
          </p>
        </div>
        <StatusBadge status={listing.status} />
      </button>
      <ListingModal lead={listing} open={open} onOpenChange={setOpen} />
    </>
  );
}
