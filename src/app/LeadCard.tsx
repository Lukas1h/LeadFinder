"use client";

import { useState, type ReactNode } from "react";
import type { Listing } from "@/db/schema";
import { formatPrice, formatDate } from "@/lib/format";
import { ListingModal } from "./ListingModal";
import { Card } from "@/components/ui/card";

export function LeadCard({
  lead,
  badges,
  actions,
}: {
  lead: Listing;
  badges?: ReactNode;
  actions: ReactNode;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Card className="flex-col sm:flex-row gap-4 p-4">
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="shrink-0 w-full sm:w-40 h-40 sm:h-32 rounded-lg overflow-hidden bg-muted flex items-center justify-center"
      >
        {lead.photos && lead.photos.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lead.photos[0]}
            alt={lead.address ?? "Listing photo"}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-muted-foreground text-sm">No photo</span>
        )}
      </button>

      <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="font-semibold text-foreground hover:underline text-left"
            >
              {lead.address ?? "Unknown address"}
            </button>
            {badges}
          </div>

          <div className="text-xl font-semibold text-foreground mt-1">{formatPrice(lead.price)}</div>

          <div className="text-sm text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
            <span>{[lead.city, lead.state].filter(Boolean).join(", ")}</span>
            <span>
              {lead.bedrooms ?? "—"} bd / {lead.bathrooms ?? "—"} ba
            </span>
            <span>{lead.livingArea ? `${lead.livingArea.toLocaleString()} sqft` : "—"}</span>
            <span>Listed {formatDate(lead.listedAt)}</span>
          </div>

          {lead.agentName && (
            <div className="text-sm mt-1.5">
              <span className="text-foreground/90">{lead.agentName}</span>
              {lead.brokerName && <span className="text-muted-foreground"> · {lead.brokerName}</span>}
            </div>
          )}
        </div>

        {actions}
      </div>

      <ListingModal lead={lead} open={modalOpen} onOpenChange={setModalOpen} />
    </Card>
  );
}
