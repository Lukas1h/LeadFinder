"use client";

import { useTransition } from "react";
import { updateListingStatus } from "./actions";
import { LEAD_STATUSES, type LeadStatus } from "@/db/schema";

const LABELS: Record<LeadStatus, string> = {
  new: "New",
  saved: "Saved",
  contacted: "Contacted",
  replied: "Replied",
  booked: "Booked",
  declined: "Declined",
};

export function StatusControl({ listingId, status }: { listingId: string; status: LeadStatus }) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      value={status}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value as LeadStatus;
        startTransition(() => {
          updateListingStatus(listingId, next);
        });
      }}
      className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-transparent disabled:opacity-50"
    >
      {LEAD_STATUSES.map((s) => (
        <option key={s} value={s}>
          {LABELS[s]}
        </option>
      ))}
    </select>
  );
}
