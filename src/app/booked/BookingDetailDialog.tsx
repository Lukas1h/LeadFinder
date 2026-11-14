"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, CalendarDays, CalendarCheck, KeyRound, StickyNote, BadgeDollarSign, Check, RotateCcw, Pencil, Car, Receipt, Send, CalendarPlus, MapPin } from "lucide-react";
import { confirmBookingDate, markBookingShot, markInvoiceSent, reopenBooking } from "./actions";
import { CompleteBookingDialog } from "./CompleteBookingDialog";
import { BookingMoney } from "./BookingMoney";
import { BookingForm } from "./BookingForm";
import { ShareGalleryButton, GalleryLinkButton, HidePayOnlineButton, PaymentLinkButton, StagingToggleButton } from "./GallerySection";
import { HighlightPhotosButton } from "./HighlightPhotosButton";
import { GalleryActivity } from "./GalleryActivity";
import { AirspaceSection } from "./AirspaceSection";
import { ShooterSection } from "./ShooterSection";
import { ListingRow } from "@/app/ListingRow";
import { AgentRow } from "@/app/AgentRow";
import { formatPrice, formatDateTime } from "@/lib/format";
import { BOOKING_STAGES, STAGE_LABELS, previousStage, stageIndex, type BookingStage } from "@/lib/bookingStages";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { BookingWithDetails } from "./BookedList";

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
  const [completeOpen, setCompleteOpen] = useState(false);

  const run = (action: (id: string) => Promise<unknown>, done: string) => {
    startTransition(async () => {
      await action(booking.id);
      toast.success(done);
      router.refresh();
    });
  };

  const back = previousStage(booking.stage);
  const next = NEXT_ACTION[booking.stage];

  const total = booking.lineItems.reduce((sum, li) => sum + li.amount, 0);
  const location = [booking.address, booking.city, booking.state].filter(Boolean).join(", ") || "No address on file";
  // Apple Maps geocodes the query string, so address + city + state is what it
  // gets — bookings carry no zip or lat/lng. The https form rather than the
  // maps:// scheme so the button still resolves on a desktop browser instead of
  // erroring on an unhandled protocol.
  const appleMapsHref = booking.address
    ? `https://maps.apple.com/?q=${encodeURIComponent(location)}`
    : null;

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

        <StageSteps stage={booking.stage} />

        {next && (
          <div className="flex flex-col gap-1">
            <Button
              className="w-full"
              disabled={isPending}
              onClick={() => {
                if (booking.stage === "invoice_sent") setCompleteOpen(true);
                else if (booking.stage === "tentative") run(confirmBookingDate, "Date confirmed");
                else if (booking.stage === "scheduled") run(markBookingShot, "Moved to Editing");
                else run(markInvoiceSent, "Marked invoice sent");
              }}
            >
              <next.icon />
              {next.label}
            </Button>
            {next.hint && <p className="text-xs text-muted-foreground text-center">{next.hint}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            asChild
            onClick={() => {
              // The invoice route assigns a number server-side on first
              // open (see its own comment) — this component has no signal
              // for when that finishes, so refresh after a beat to pick up
              // the new number for next time this dialog opens.
              if (!booking.invoiceNumber) setTimeout(() => router.refresh(), 1500);
            }}
          >
            <a href={`/api/bookings/${booking.id}/invoice`} target="_blank" rel="noopener noreferrer">
              <Receipt />
              {booking.invoiceNumber ? `Invoice #${booking.invoiceNumber}` : "Create invoice"}
            </a>
          </Button>
          {booking.jobDate && (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/bookings/${booking.id}/calendar`}>
                <CalendarPlus />
                Add to calendar
              </a>
            </Button>
          )}
          <GalleryLinkButton booking={booking} onAddGallery={() => setEditOpen(true)} />
          <ShareGalleryButton booking={booking} />
          <PaymentLinkButton booking={booking} />
          <HidePayOnlineButton booking={booking} />
          <StagingToggleButton booking={booking} />
          <HighlightPhotosButton booking={booking} />
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil />
            Edit
          </Button>
          {back && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => run(reopenBooking, `Back to ${STAGE_LABELS[back]}`)}
              disabled={isPending}
            >
              <RotateCcw />
              Back to {STAGE_LABELS[back]}
            </Button>
          )}
          {appleMapsHref && (
            <Button variant="outline" size="sm" asChild>
              <a href={appleMapsHref} target="_blank" rel="noopener noreferrer">
                <MapPin />
                Apple Maps
              </a>
            </Button>
          )}
        </div>

        <AirspaceSection booking={booking} />

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

        {(stageIndex(booking.stage) >= stageIndex("editing") || booking.costs.trips.length > 0 || booking.costs.expenseItems.length > 0) && (
          <BookingMoney booking={booking} open={open} />
        )}

        <ShooterSection key={`${booking.shooter?.name}-${booking.shooter?.pay}`} booking={booking} />

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

        {booking.invoiceNote && (
          <div className="text-sm text-foreground/90 flex items-start gap-1.5">
            <Receipt className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
            <span>
              <span className="text-muted-foreground">On invoice: </span>
              {booking.invoiceNote}
            </span>
          </div>
        )}

        {(booking.contactName || booking.contactPhone) && (
          <div className="border-t pt-2">
            <AgentRow name={booking.contactName} phone={booking.contactPhone} />
          </div>
        )}

        {booking.listing && (
          <div className="border-t pt-2">
            <ListingRow listing={booking.listing} />
          </div>
        )}

        {booking.galleryToken && <GalleryActivity bookingId={booking.id} open={open} />}
      </DialogContent>

      <BookingForm booking={booking} open={editOpen} onOpenChange={setEditOpen} />
      <CompleteBookingDialog booking={booking} open={completeOpen} onOpenChange={setCompleteOpen} />
    </Dialog>
  );
}

/** The one thing to do next at each stage; completed has none. */
const NEXT_ACTION: Record<BookingStage, { label: string; icon: typeof Camera; hint?: string } | null> = {
  tentative: { label: "Confirm date", icon: CalendarCheck },
  scheduled: { label: "Mark shot", icon: Camera },
  editing: {
    label: "Mark invoice sent",
    icon: Send,
    hint: "Copying the client gallery link does this automatically.",
  },
  invoice_sent: { label: "Mark paid", icon: BadgeDollarSign },
  completed: null,
};

/** Where the job is: five dots on a line, done ones filled, the current one labeled. */
function StageSteps({ stage }: { stage: BookingStage }) {
  const current = stageIndex(stage);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label={`Stage: ${STAGE_LABELS[stage]}`}>
      {BOOKING_STAGES.map((s, i) => {
        const done = i < current || stage === "completed";
        const here = i === current;
        return (
          <li key={s} className="flex flex-col items-center gap-1 text-center">
            <div className="relative flex w-full items-center justify-center">
              {i > 0 && (
                <span
                  className={cn("absolute right-1/2 h-px w-full", i <= current ? "bg-foreground/60" : "bg-border")}
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex size-4 items-center justify-center rounded-full border",
                  done
                    ? "border-foreground bg-foreground text-background"
                    : here
                      ? "border-foreground bg-background ring-2 ring-foreground/15"
                      : "border-border bg-background",
                )}
              >
                {done && <Check className="size-2.5" strokeWidth={3} />}
              </span>
            </div>
            <span
              className={cn(
                "text-[11px] leading-tight",
                here ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {STAGE_LABELS[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
