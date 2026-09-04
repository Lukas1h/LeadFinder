"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, X } from "lucide-react";
import type { Listing } from "@/db/schema";
import { updateListingNotes } from "./actions";
import { PhotoCarousel } from "./PhotoCarousel";
import { formatPrice, formatDate } from "@/lib/format";
import { Dialog, DialogContent, DialogClose, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function ListingModal({
  lead,
  open,
  onOpenChange,
}: {
  lead: Listing;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const dirty = notes !== (lead.notes ?? "");

  const handleSaveNotes = () => {
    startTransition(async () => {
      await updateListingNotes(lead.id, notes);
      toast.success("Note saved");
      router.refresh();
    });
  };

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

          {lead.sourceLabel && (
            <div className="text-xs text-muted-foreground">Source: {lead.sourceLabel}</div>
          )}

          <Button variant="outline" asChild className="mt-2">
            <a href={lead.listingUrl ?? "#"} target="_blank" rel="noopener noreferrer">
              View on Zillow
              <ExternalLink />
            </a>
          </Button>

          <div className="flex flex-col gap-1.5 border-t pt-3">
            <Label htmlFor="listing-notes" className="text-xs text-muted-foreground">
              Notes
            </Label>
            <Textarea
              id="listing-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering about this one…"
              rows={3}
            />
            {dirty && (
              <Button size="sm" onClick={handleSaveNotes} disabled={isPending} className="self-end">
                {isPending ? "Saving…" : "Save note"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
