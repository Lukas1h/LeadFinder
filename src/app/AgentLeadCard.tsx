"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, StickyNote } from "lucide-react";
import type { Agent, Listing } from "@/db/schema";
import { formatPrice, formatDate } from "@/lib/format";
import { AgentDetailDialog } from "./agents/AgentDetailDialog";
import { RelationshipBadge } from "./badges";
import { ListingModal } from "./ListingModal";
import { ListingRow } from "./ListingRow";
import { PhotoCarousel } from "./PhotoCarousel";
import { Card } from "@/components/ui/card";
import { sampleCardPhotos } from "@/lib/cardPhotos";

/**
 * One agent on the Leads page. Outreach is about the person now — most texts
 * offer Lukas as a backup photographer rather than pitching a property — so
 * the agent leads the card, and their best open listing sits under them as the
 * reason to text. Any other open listings fold away beneath it.
 */
export function AgentLeadCard({
  agent,
  agentName,
  brokerName,
  contactLine,
  lead,
  others,
  badges,
  actions,
}: {
  agent: Agent | null;
  agentName: string | null;
  brokerName: string | null;
  /** "Texted Oct 5", "Emailed Sep 14, never texted", "Never contacted". */
  contactLine: string | null;
  /** The best of their open listings — what a text would be about. */
  lead: Listing;
  /** Their other open listings. */
  others: Listing[];
  badges?: ReactNode;
  actions: ReactNode;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const name = agent?.name ?? agentName ?? "No agent listed";
  const total = others.length + 1;

  const nameEl = (
    <span className="text-base font-semibold text-foreground">{name}</span>
  );

  return (
    <Card className="p-4 gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {agent ? (
              <AgentDetailDialog
                agent={agent}
                trigger={
                  <button type="button" className="hover:underline text-left">
                    {nameEl}
                  </button>
                }
              />
            ) : (
              nameEl
            )}
            {agent && agent.relationshipStatus !== "cold" && (
              <RelationshipBadge status={agent.relationshipStatus} agentName={agent.name} className="shrink-0" />
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate">
            {/* Contact first: brokerages can be long enough to truncate it. */}
            {[contactLine, brokerName].filter(Boolean).join(" · ")}
          </p>
        </div>
        {total > 1 && (
          <span className="shrink-0 text-xs text-muted-foreground mt-1">{total} listings</span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="shrink-0 w-full sm:w-40 sm:self-center">
          <PhotoCarousel
            photos={sampleCardPhotos(lead.photos ?? [])}
            alt={lead.address ?? "Listing photo"}
            onTap={() => setModalOpen(true)}
            sizeClassName="w-full h-40 sm:h-32 sm:w-40"
          />
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="font-medium text-foreground hover:underline text-left"
              >
                {lead.address ?? "Unknown address"}
              </button>
              {badges}
            </div>
            <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-3">
              <span className="font-semibold text-foreground">{formatPrice(lead.price)}</span>
              <span>{[lead.city, lead.state].filter(Boolean).join(", ")}</span>
              <span>
                {lead.bedrooms ?? "—"} bd / {lead.bathrooms ?? "—"} ba
              </span>
              <span>Listed {formatDate(lead.listedAt)}</span>
            </div>
            {lead.notes && (
              <div className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1 line-clamp-1">
                <StickyNote className="size-3.5 shrink-0 mt-0.5" />
                {lead.notes}
              </div>
            )}
          </div>

          {actions}
        </div>
      </div>

      {others.length > 0 && (
        <div className="border-t pt-2 -mb-1">
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={`size-4 transition-transform ${showOthers ? "rotate-90" : ""}`} />
            {others.length} more listing{others.length === 1 ? "" : "s"}
          </button>
          {showOthers && (
            <div className="flex flex-col -mx-2 mt-1">
              {others.map((l) => (
                <ListingRow key={l.id} listing={l} />
              ))}
            </div>
          )}
        </div>
      )}

      <ListingModal lead={lead} open={modalOpen} onOpenChange={setModalOpen} />
    </Card>
  );
}
