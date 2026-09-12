"use client";

import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { getBookingWithDetails } from "./actions";
import { BookingDetailDialog } from "./BookingDetailDialog";
import { formatDateOnly, formatPrice } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import type { BookingWithDetails } from "./BookedList";

/**
 * Compact clickable row for referencing a booking — same look as
 * ListingRow/AgentRow (@/app/ListingRow, @/app/AgentRow), just with a
 * calendar icon instead of a photo. Two ways in: pass just
 * `bookingId` (a listing's detail modal only knows the bare id) and this
 * fetches the full joined details lazily on first click; pass a preloaded
 * `booking` too (AgentDetailDialog already eager-fetches its agent's whole
 * booking list via getAgentBookings) and it skips the fetch entirely.
 */
export function BookingRow({ bookingId, booking: preloaded }: { bookingId: string; booking?: BookingWithDetails }) {
  const [booking, setBooking] = useState<BookingWithDetails | null>(preloaded ?? null);
  const [loaded, setLoaded] = useState(!!preloaded);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleClick = async () => {
    if (!loaded) {
      setLoading(true);
      const result = await getBookingWithDetails(bookingId);
      setBooking(result);
      setLoaded(true);
      setLoading(false);
      if (!result) return;
    }
    setOpen(true);
  };

  const total = booking?.lineItems.reduce((sum, li) => sum + li.amount, 0) ?? 0;
  const subtitle = !loaded
    ? loading
      ? "Loading…"
      : "View details"
    : [total > 0 ? formatPrice(total) : null, booking?.contactName].filter(Boolean).join(" · ") || "View details";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex items-center gap-3 w-full text-left rounded-lg p-2 hover:bg-muted/50 disabled:opacity-60"
      >
        <div className="size-12 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
          <CalendarCheck className="size-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {booking?.jobDate ? formatDateOnly(booking.jobDate) : loaded ? "No job date set" : "Booking"}
          </p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {booking?.completedAt && <Badge variant="secondary">Completed</Badge>}
      </button>
      {booking && <BookingDetailDialog booking={booking} open={open} onOpenChange={setOpen} />}
    </>
  );
}
