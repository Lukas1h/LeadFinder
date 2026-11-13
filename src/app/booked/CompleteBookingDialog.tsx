"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeDollarSign } from "lucide-react";
import { markBookingCompleted } from "./actions";
import { CompletionFields } from "./CompletionFields";
import { fromCompletionDraft, toCompletionDraft } from "./bookingMath";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { BookingWithDetails } from "./BookedList";

/**
 * "Mark paid": the money came in another way (cash, check, $0 job), so the
 * job is completed. Asks for the job's hours in the same step so every
 * finished booking has them on file. Square payments complete it on their own. Any field can be left blank. The drive and the
 * job's expenses are logged from the booking's "Time & money" section.
 */
export function CompleteBookingDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: BookingWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => toCompletionDraft(booking));
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    await markBookingCompleted(booking.id, fromCompletionDraft(draft));
    setIsSaving(false);
    toast.success("Marked paid");
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(toCompletionDraft(booking));
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Mark paid</DialogTitle>
            <DialogDescription>The client paid, so this job is done. How long did the work take? Leave anything you don&rsquo;t know blank. The drive and any expenses go under Time &amp; money.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <CompletionFields value={draft} onChange={setDraft} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSaving}>
              <BadgeDollarSign />
              {isSaving ? "Saving…" : "Mark paid"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
