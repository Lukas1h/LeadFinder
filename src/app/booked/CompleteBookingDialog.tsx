"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
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
 * Asks for the job's time and costs before marking it completed, so every
 * finished booking has that on file. Any field can be left blank.
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
    toast.success("Marked completed");
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
            <DialogTitle>Complete booking</DialogTitle>
            <DialogDescription>How long did this job take, and what did it cost you? Leave anything you don&rsquo;t know blank.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <CompletionFields value={draft} onChange={setDraft} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSaving}>
              <CheckCircle2 />
              {isSaving ? "Saving…" : "Mark completed"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
