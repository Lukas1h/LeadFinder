"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, KeyRound, StickyNote, CheckCircle2, RotateCcw, Pencil, User, Car } from "lucide-react";
import { markBookingCompleted, reopenBooking } from "./actions";
import { BookingForm } from "./BookingForm";
import { ListingRow } from "@/app/ListingRow";
import { formatPrice, formatDateTime, formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { BookingWithDetails } from "./BookedList";

/** Same look as ListingRow (@/app/ListingRow) — a little card, not a text
 * link — just with a generic contact icon instead of a photo. */
function ContactRow({ name, phone }: { name: string | null; phone: string | null }) {
  return (
    <Link
      href={`/agents?agent=${encodeURIComponent(phone ?? "")}`}
      className="flex items-center gap-3 w-full text-left rounded-lg p-2 hover:bg-muted/50"
    >
      <div className="size-12 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
        <User className="size-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{name ?? "Unknown contact"}</p>
        {phone && <p className="text-xs text-muted-foreground">{formatPhone(phone)}</p>}
      </div>
    </Link>
  );
}

/**
 * Read-only detail view for a booking — opened by clicking a BookingCard.
 * Mirrors AgentDetailDialog's shape: header, an action row ending in an
 * Edit button, then read-only sections below. Edit opens BookingForm (the
 * actual form) as a stacked dialog rather than turning this view itself
 * into a form — this dialog is for looking, not typing.
 */
export function BookingDetailDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: BookingWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  const handleComplete = () => {
    startTransition(async () => {
      await markBookingCompleted(booking.id);
      toast.success("Marked completed");
      router.refresh();
    });
  };

  const handleReopen = () => {
    startTransition(async () => {
      await reopenBooking(booking.id);
      toast.success("Reopened");
      router.refresh();
    });
  };

  const total = booking.lineItems.reduce((sum, li) => sum + li.amount, 0);
  const location = [booking.address, booking.city, booking.state].filter(Boolean).join(", ") || "No address on file";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{location}</DialogTitle>
          <DialogDescription className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              {booking.jobDate ? formatDateTime(booking.jobDate) : "No job date set"}
            </span>
            {booking.driveTime && (
              <span className="flex items-center gap-1.5">
                <Car className="size-3.5" />
                {booking.driveTime}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {booking.completedAt ? (
            <Button variant="outline" size="sm" onClick={handleReopen} disabled={isPending}>
              <RotateCcw />
              Reopen
            </Button>
          ) : (
            <Button size="sm" onClick={handleComplete} disabled={isPending}>
              <CheckCircle2 />
              Mark completed
            </Button>
          )}
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setEditOpen(true)}>
            <Pencil />
            Edit
          </Button>
        </div>

        {booking.lineItems.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground mb-1.5">Line items</p>
            <div className="flex flex-col gap-1">
              {booking.lineItems.map((li, i) => (
                <div key={i} className="flex items-center justify-between text-sm gap-3">
                  <span className="text-foreground/90 truncate">{li.description}</span>
                  <span className="text-foreground shrink-0">{formatPrice(li.amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm font-semibold border-t pt-1 mt-1">
                <span>Total</span>
                <span>{formatPrice(total)}</span>
              </div>
            </div>
          </div>
        )}

        {booking.lockboxCode && (
          <div className="text-sm text-muted-foreground flex items-center gap-1.5 border-t pt-3">
            <KeyRound className="size-3.5" />
            Lockbox: {booking.lockboxCode}
          </div>
        )}

        {booking.notes && (
          <div className="text-sm text-foreground/90 flex items-start gap-1.5 border-t pt-3">
            <StickyNote className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
            {booking.notes}
          </div>
        )}

        {(booking.contactName || booking.contactPhone) && (
          <div className="border-t pt-2">
            <ContactRow name={booking.contactName} phone={booking.contactPhone} />
          </div>
        )}

        {booking.listing && (
          <div className="border-t pt-2">
            <ListingRow listing={booking.listing} />
          </div>
        )}
      </DialogContent>

      <BookingForm booking={booking} open={editOpen} onOpenChange={setEditOpen} />
    </Dialog>
  );
}
