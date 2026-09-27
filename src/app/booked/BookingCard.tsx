"use client";

import { useState } from "react";
import { CalendarDays, KeyRound, StickyNote, Phone, Car } from "lucide-react";
import { BookingDetailDialog } from "./BookingDetailDialog";
import { bookingProfit } from "./bookingMath";
import { formatPrice, formatDateTime, formatPhone } from "@/lib/format";
import { Card } from "@/components/ui/card";
import type { BookingWithDetails } from "./BookedList";

/**
 * Summary card — the whole card is one click target that opens
 * BookingDetailDialog, which is where every status action lives. It
 * deliberately has no nested links or buttons, so a tap anywhere opens
 * the booking.
 */
export function BookingCard({ booking }: { booking: BookingWithDetails }) {
  const [detailOpen, setDetailOpen] = useState(false);

  const profit = bookingProfit(booking);
  const location = [booking.address, booking.city, booking.state].filter(Boolean).join(", ") || "No address on file";

  return (
    <>
      <Card
        className="flex-col gap-3 p-4 cursor-pointer hover:border-foreground/20 transition-colors"
        onClick={() => setDetailOpen(true)}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold text-foreground">{location}</div>
            <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              {booking.jobDate ? formatDateTime(booking.jobDate) : "No job date set"}
            </div>
            {booking.driveTime && (
              <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                <Car className="size-3.5" />
                {booking.driveTime}
              </div>
            )}
          </div>
          {profit !== 0 && <div className="text-lg font-semibold text-foreground">{formatPrice(profit)}</div>}
        </div>

        {(booking.contactName || booking.contactPhone) && (
          <div className="text-sm text-foreground/90 flex flex-col gap-0.5">
            {booking.contactName && <span>{booking.contactName}</span>}
            {booking.contactPhone && (
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Phone className="size-3.5" />
                {formatPhone(booking.contactPhone)}
              </span>
            )}
          </div>
        )}

        {booking.lockboxCode && (
          <div className="text-sm text-muted-foreground flex items-center gap-1.5">
            <KeyRound className="size-3.5" />
            Lockbox: {booking.lockboxCode}
          </div>
        )}

        {booking.notes && (
          <div className="text-xs text-muted-foreground flex items-start gap-1.5">
            <StickyNote className="size-3.5 shrink-0 mt-0.5" />
            {booking.notes}
          </div>
        )}

      </Card>

      <BookingDetailDialog booking={booking} open={detailOpen} onOpenChange={setDetailOpen} />
    </>
  );
}
