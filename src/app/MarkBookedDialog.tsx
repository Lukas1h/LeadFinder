"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { updateListingStatus } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

export function MarkBookedDialog({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    const bookingValue = value.trim() ? Number(value) : null;
    startTransition(async () => {
      await updateListingStatus(listingId, "booked", bookingValue);
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={isPending}>
          <CheckCircle2 />
          Mark booked
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark booked</DialogTitle>
          <DialogDescription>
            Job value is optional, but it&rsquo;s what lets the presets page eventually show revenue
            per message, not just response rate.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5 py-2">
          <Label htmlFor="booking-value">Booking value ($)</Label>
          <Input
            id="booking-value"
            type="number"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <DialogFooter>
          <Button onClick={handleConfirm} disabled={isPending}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
