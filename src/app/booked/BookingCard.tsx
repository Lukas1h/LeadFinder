"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, KeyRound, StickyNote, CheckCircle2, RotateCcw, Phone, Car } from "lucide-react";
import { markBookingCompleted, reopenBooking } from "./actions";
import { BookingDetailDialog } from "./BookingDetailDialog";
import { formatPrice, formatDateTime, formatPhone } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { BookingWithDetails } from "./BookedList";

/**
 * Summary card — the whole card is one click target that opens
 * BookingDetailDialog, so it deliberately has no nested links (an address
 * link to /pipeline used to live here and was too easy to fat-finger by
 * accident instead of opening the card). The only other interactive
 * element is Mark completed/Reopen, which stops propagation so it doesn't
 * also open the dialog.
 */
export function BookingCard({ booking }: { booking: BookingWithDetails }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [detailOpen, setDetailOpen] = useState(false);

  const handleComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    startTransition(async () => {
      await markBookingCompleted(booking.id);
      toast.success("Marked completed");
      router.refresh();
    });
  };

  const handleReopen = (e: React.MouseEvent) => {
    e.stopPropagation();
    startTransition(async () => {
      await reopenBooking(booking.id);
      toast.success("Reopened");
      router.refresh();
    });
  };

  const total = booking.lineItems.reduce((sum, li) => sum + li.amount, 0);
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
          {total > 0 && <div className="text-lg font-semibold text-foreground">{formatPrice(total)}</div>}
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

        <div>
          {booking.completedAt ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={handleReopen}
              disabled={isPending}
            >
              <RotateCcw />
              Reopen
            </Button>
          ) : (
            <Button size="sm" onClick={handleComplete} disabled={isPending}>
              <CheckCircle2 />
              Mark completed
            </Button>
          )}
        </div>
      </Card>

      <BookingDetailDialog booking={booking} open={detailOpen} onOpenChange={setDetailOpen} />
    </>
  );
}
