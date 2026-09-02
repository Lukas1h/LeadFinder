"use client";

import { useEffect, useRef } from "react";
import type { Listing } from "@/db/schema";
import { PhotoCarousel } from "./PhotoCarousel";
import { formatPrice, formatDate } from "@/lib/format";

export function ListingModal({
  lead,
  open,
  onClose,
}: {
  lead: Listing;
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="rounded-xl shadow-xl w-full max-w-lg p-0 m-auto backdrop:bg-black/50"
    >
      {open && (
        <div className="max-h-[85vh] overflow-y-auto">
          <div className="relative">
            <PhotoCarousel
              photos={lead.photos ?? []}
              alt={lead.address ?? "Listing photo"}
              alwaysShowControls
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/70"
            >
              ✕
            </button>
          </div>

          <div className="p-5 flex flex-col gap-3">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {lead.address ?? "Unknown address"}
              </h2>
              <div className="text-sm text-gray-500">
                {[lead.city, lead.state, lead.zipcode].filter(Boolean).join(", ")}
              </div>
            </div>

            <div className="text-2xl font-semibold text-gray-900">{formatPrice(lead.price)}</div>

            <div className="text-sm text-gray-600 flex flex-wrap gap-x-3">
              <span>
                {lead.bedrooms ?? "—"} bd / {lead.bathrooms ?? "—"} ba
              </span>
              <span>{lead.livingArea ? `${lead.livingArea.toLocaleString()} sqft` : "—"}</span>
              {lead.homeType && <span>{lead.homeType}</span>}
              <span>Listed {formatDate(lead.listedAt)}</span>
            </div>

            {(lead.agentName || lead.brokerName) && (
              <div className="text-sm text-gray-700 border-t border-gray-100 pt-3">
                {lead.agentName && <div>{lead.agentName}</div>}
                {lead.brokerName && <div className="text-gray-400">{lead.brokerName}</div>}
              </div>
            )}

            <a
              href={lead.listingUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 mt-2"
            >
              View on Zillow
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
              </svg>
            </a>
          </div>
        </div>
      )}
    </dialog>
  );
}
