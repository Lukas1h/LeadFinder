"use client";

import { useState } from "react";
import type { Agent, Listing } from "@/db/schema";
import { formatPrice, formatDate } from "@/lib/format";
import { StatusBadge } from "@/app/badges";
import { ListingModal } from "@/app/ListingModal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

function ListingRow({ listing }: { listing: Listing }) {
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

export function AgentDetailDialog({
  agent,
  listings,
  trigger,
}: {
  agent: Agent;
  listings: Listing[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{agent.name ?? "Unknown name"}</DialogTitle>
          <DialogDescription className="font-mono">{agent.phone}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto -mx-2">
          {listings.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 px-2">No listings from this agent yet.</p>
          ) : (
            listings.map((l) => <ListingRow key={l.id} listing={l} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
