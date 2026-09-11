"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, X } from "lucide-react";
import { LEAD_STATUSES, type Listing, type LeadStatus } from "@/db/schema";
import { updateListingNotes, updateListingStatus, updateListingFollowUp } from "./actions";
import { PhotoCarousel } from "./PhotoCarousel";
import { STATUS_LABELS } from "./badges";
import { BookingForm } from "./booked/BookingForm";
import { BookingRow } from "./booked/BookingRow";
import { formatPrice, formatDate, formatPhone } from "@/lib/format";
import { telUrl } from "@/lib/sms";
import { Dialog, DialogContent, DialogClose, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ListingModal({
  lead,
  open,
  onOpenChange,
}: {
  lead: Listing;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const [statusPending, startStatusTransition] = useTransition();
  const dirty = notes !== (lead.notes ?? "");

  const [bookingFormOpen, setBookingFormOpen] = useState(false);

  const initialFollowUpAt = lead.followUpAt ? lead.followUpAt.toISOString().slice(0, 10) : "";
  const [followUpAt, setFollowUpAt] = useState(initialFollowUpAt);
  const [followUpNote, setFollowUpNote] = useState(lead.followUpNote ?? "");
  const [followUpPending, startFollowUpTransition] = useTransition();
  const followUpDirty = followUpAt !== initialFollowUpAt || followUpNote !== (lead.followUpNote ?? "");

  const handleSaveNotes = () => {
    startTransition(async () => {
      await updateListingNotes(lead.id, notes);
      toast.success("Note saved");
      router.refresh();
    });
  };

  const handleSaveFollowUp = () => {
    startFollowUpTransition(async () => {
      await updateListingFollowUp(lead.id, followUpAt ? new Date(followUpAt) : null, followUpNote);
      toast.success("Follow-up saved");
      router.refresh();
    });
  };

  const handleStatusChange = (status: LeadStatus) => {
    // Booking needs more than a bare status flip — job date, contact, price
    // — so open the booking form instead of transitioning immediately. The
    // Select stays showing the old status (it's bound to lead.status, not
    // local state) unless the booking is actually confirmed.
    if (status === "booked") {
      setBookingFormOpen(true);
      return;
    }
    startStatusTransition(async () => {
      await updateListingStatus(lead.id, status);
      toast.success("Status updated");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">{lead.address ?? "Listing details"}</DialogTitle>

        <div className="relative">
          <PhotoCarousel
            photos={lead.photos ?? []}
            alt={lead.address ?? "Listing photo"}
            alwaysShowControls
          />
          <DialogClose asChild>
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-2 right-2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
            >
              <X />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {lead.address ?? "Unknown address"}
            </h2>
            <div className="text-sm text-muted-foreground">
              {[lead.city, lead.state, lead.zipcode].filter(Boolean).join(", ")}
            </div>
          </div>

          <div className="text-2xl font-semibold text-foreground">{formatPrice(lead.price)}</div>

          <div className="text-sm text-muted-foreground flex flex-wrap gap-x-3">
            <span>
              {lead.bedrooms ?? "—"} bd / {lead.bathrooms ?? "—"} ba
            </span>
            <span>{lead.livingArea ? `${lead.livingArea.toLocaleString()} sqft` : "—"}</span>
            {lead.homeType && <span>{lead.homeType}</span>}
            <span>Listed {formatDate(lead.listedAt)}</span>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground shrink-0">Status</Label>
            <Select
              value={lead.status}
              onValueChange={(v) => handleStatusChange(v as LeadStatus)}
              disabled={statusPending}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(lead.agentName || lead.brokerName || lead.agentPhone) && (
            <div className="text-sm text-foreground/90 border-t pt-3">
              {lead.agentPhone ? (
                <Link
                  href={`/agents?agent=${encodeURIComponent(lead.agentPhone)}`}
                  onClick={() => onOpenChange(false)}
                  className="hover:underline"
                >
                  {lead.agentName && <div>{lead.agentName}</div>}
                  {lead.brokerName && <div className="text-muted-foreground">{lead.brokerName}</div>}
                </Link>
              ) : (
                <>
                  {lead.agentName && <div>{lead.agentName}</div>}
                  {lead.brokerName && <div className="text-muted-foreground">{lead.brokerName}</div>}
                </>
              )}
              {lead.agentPhone && (
                <a
                  href={telUrl(lead.agentPhone) ?? "#"}
                  className="text-muted-foreground hover:underline hover:text-foreground"
                >
                  {formatPhone(lead.agentPhone)}
                </a>
              )}
            </div>
          )}

          {lead.sourceLabel && (
            <div className="text-xs text-muted-foreground">Source: {lead.sourceLabel}</div>
          )}

          <Button variant="outline" asChild className="mt-2">
            <a href={lead.listingUrl ?? "#"} target="_blank" rel="noopener noreferrer">
              View on Zillow
              <ExternalLink />
            </a>
          </Button>

          {lead.bookingId && (
            <div className="flex flex-col gap-1 border-t pt-2">
              <BookingRow bookingId={lead.bookingId} />
              <BookingForm
                listingId={lead.id}
                agentName={lead.agentName}
                agentPhone={lead.agentPhone}
                trigger={
                  <Button variant="outline" size="sm" className="self-end">
                    New booking
                  </Button>
                }
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5 border-t pt-3">
            <Label className="text-xs text-muted-foreground">Follow up</Label>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={followUpAt}
                onChange={(e) => setFollowUpAt(e.target.value)}
                className="w-40"
              />
              <Input
                value={followUpNote}
                onChange={(e) => setFollowUpNote(e.target.value)}
                placeholder="e.g. check if the house sold yet"
                className="flex-1"
              />
            </div>
            {followUpDirty && (
              <Button
                size="sm"
                onClick={handleSaveFollowUp}
                disabled={followUpPending}
                className="self-end"
              >
                {followUpPending ? "Saving…" : "Save follow-up"}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-1.5 border-t pt-3">
            <Label htmlFor="listing-notes" className="text-xs text-muted-foreground">
              Notes
            </Label>
            <Textarea
              id="listing-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering about this one…"
              rows={3}
            />
            {dirty && (
              <Button size="sm" onClick={handleSaveNotes} disabled={isPending} className="self-end">
                {isPending ? "Saving…" : "Save note"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>

      <BookingForm
        listingId={lead.id}
        agentName={lead.agentName}
        agentPhone={lead.agentPhone}
        open={bookingFormOpen}
        onOpenChange={setBookingFormOpen}
      />
    </Dialog>
  );
}
