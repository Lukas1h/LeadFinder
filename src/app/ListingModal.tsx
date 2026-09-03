"use client";

import { ExternalLink, X } from "lucide-react";
import type { Listing } from "@/db/schema";
import { PhotoCarousel } from "./PhotoCarousel";
import { formatPrice, formatDate } from "@/lib/format";
import { Dialog, DialogContent, DialogClose, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ListingModal({
  lead,
  open,
  onOpenChange,
}: {
  lead: Listing;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="p-0 sm:max-w-lg overflow-hidden">
        <DialogTitle className="sr-only">{lead.address ?? "Listing details"}</DialogTitle>

        <div className="relative">
          <PhotoCarousel
            photos={lead.photos ?? []}
            alt={lead.address ?? "Listing photo"}
            alwaysShowControls
          />
          <DialogClose asChild>
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-2 right-2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
            >
              <X />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {lead.address ?? "Unknown address"}
            </h2>
            <div className="text-sm text-muted-foreground">
              {[lead.city, lead.state, lead.zipcode].filter(Boolean).join(", ")}
            </div>
          </div>

          <div className="text-2xl font-semibold text-foreground">{formatPrice(lead.price)}</div>

          <div className="text-sm text-muted-foreground flex flex-wrap gap-x-3">
            <span>
              {lead.bedrooms ?? "—"} bd / {lead.bathrooms ?? "—"} ba
            </span>
            <span>{lead.livingArea ? `${lead.livingArea.toLocaleString()} sqft` : "—"}</span>
            {lead.homeType && <span>{lead.homeType}</span>}
            <span>Listed {formatDate(lead.listedAt)}</span>
          </div>

          {(lead.agentName || lead.brokerName) && (
            <div className="text-sm text-foreground/90 border-t pt-3">
              {lead.agentName && <div>{lead.agentName}</div>}
              {lead.brokerName && <div className="text-muted-foreground">{lead.brokerName}</div>}
            </div>
          )}

          <Button variant="outline" asChild className="mt-2">
            <a href={lead.listingUrl ?? "#"} target="_blank" rel="noopener noreferrer">
              View on Zillow
              <ExternalLink />
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
