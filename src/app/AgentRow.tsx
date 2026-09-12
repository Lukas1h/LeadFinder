"use client";

import { useState } from "react";
import { User } from "lucide-react";
import { getOrCreateAgentByPhone, type AgentWithListings } from "./agents/actions";
import { AgentDetailDialog } from "./agents/AgentDetailDialog";
import { formatPhone } from "@/lib/format";

/**
 * Compact clickable row for referencing an agent from elsewhere (a
 * listing's detail modal, a booking's detail dialog) — same look as
 * ListingRow/BookingRow (@/app/ListingRow, @/app/booked/BookingRow), just
 * with a person icon instead of a photo. Only name/phone are needed up
 * front; the full Agent row (and their other listings) is fetched lazily
 * on first click, same pattern as BookingRow, then opens
 * AgentDetailDialog in place rather than navigating to the Agents page.
 *
 * Renders as plain (non-interactive) text when there's no phone — nothing
 * to look an agent up by in that case.
 */
export function AgentRow({
  name,
  phone,
  subtitle,
}: {
  name: string | null;
  phone: string | null;
  subtitle?: string | null;
}) {
  const [data, setData] = useState<AgentWithListings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const content = (
    <>
      <div className="size-12 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
        <User className="size-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{name ?? "Unknown agent"}</p>
        {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
        {phone && (
          <p className="text-xs text-muted-foreground">{loading ? "Loading…" : formatPhone(phone)}</p>
        )}
      </div>
    </>
  );

  if (!phone) {
    return <div className="flex items-center gap-3 w-full p-2">{content}</div>;
  }

  const handleClick = async () => {
    if (!loaded) {
      setLoading(true);
      const result = await getOrCreateAgentByPhone(phone, name);
      setData(result);
      setLoaded(true);
      setLoading(false);
      if (!result) return;
    }
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex items-center gap-3 w-full text-left rounded-lg p-2 hover:bg-muted/50 disabled:opacity-60"
      >
        {content}
      </button>
      {data && <AgentDetailDialog agent={data.agent} listings={data.listings} open={open} onOpenChange={setOpen} />}
    </>
  );
}
