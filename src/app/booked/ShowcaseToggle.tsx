"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setBookingShowcase } from "./actions";
import type { BookingWithDetails } from "./BookedList";

/** Marks a nice shoot Lukas is happy to show other agents; cold follow-ups near it offer to share pics from it. */
export function ShowcaseToggle({ booking }: { booking: BookingWithDetails }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [on, setOn] = useState(Boolean(booking.showcase));

  const change = (next: boolean) => {
    setOn(next);
    startTransition(async () => {
      try {
        await setBookingShowcase(booking.id, next);
        toast.success(next ? "Marked as a showcase shoot" : "No longer a showcase shoot");
        router.refresh();
      } catch {
        setOn(!next);
        toast.error("Couldn't save showcase");
      }
    });
  };

  return (
    <label className="flex w-full items-start gap-3 rounded-md border px-3 py-2.5">
      <Switch checked={on} onCheckedChange={change} disabled={isPending} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Showcase</span>
        <span className="text-xs text-muted-foreground">
          Nice shoot you&apos;re happy to show other agents. Cold follow-ups near it offer to share pics from it.
        </span>
      </span>
    </label>
  );
}
