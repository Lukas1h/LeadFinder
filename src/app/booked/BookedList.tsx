"use client";

import { useMemo } from "react";
import { ChevronRight, Plus, CalendarCheck } from "lucide-react";
import type { Listing } from "@/db/schema";
import { BookingCard } from "./BookingCard";
import { BookingForm } from "./BookingForm";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export interface BookingWithDetails {
  id: string;
  listingId: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  // Full row of the linked listing (for the ListingRow reference card),
  // null for a manual booking with no tracked listing at all.
  listing: Listing | null;
  jobDate: Date | null;
  lockboxCode: string | null;
  notes: string | null;
  completedAt: Date | null;
  createdAt: Date;
  contactName: string | null;
  contactPhone: string | null;
  lineItems: { description: string; amount: number }[];
  // Rough "~1h 15m drive" from the home location set in Settings — see
  // src/lib/driveTime.ts. Null if either city isn't in its coordinate
  // table (no address on file, or an unrecognized city).
  driveTime: string | null;
}

export function BookedList({ bookings }: { bookings: BookingWithDetails[] }) {
  const { upcoming, completed } = useMemo(() => {
    const upcoming = bookings
      .filter((b) => !b.completedAt)
      .sort((a, b) => {
        // No job date yet sinks to the bottom rather than sorting first.
        if (!a.jobDate && !b.jobDate) return b.createdAt.getTime() - a.createdAt.getTime();
        if (!a.jobDate) return 1;
        if (!b.jobDate) return -1;
        return a.jobDate.getTime() - b.jobDate.getTime();
      });
    const completed = bookings
      .filter((b) => b.completedAt)
      .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());
    return { upcoming, completed };
  }, [bookings]);

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-center py-16 text-muted-foreground">
        <CalendarCheck className="size-8" />
        <p>Nothing booked yet — mark a lead booked from the Pipeline, or add one directly here.</p>
        <BookingForm
          trigger={
            <Button>
              <Plus />
              New booking
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <BookingForm
          trigger={
            <Button>
              <Plus />
              New booking
            </Button>
          }
        />
      </div>

      {upcoming.length > 0 && (
        <div className="flex flex-col gap-4">
          {upcoming.map((booking) => (
            <BookingCard key={booking.id} booking={booking} />
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <>
          {upcoming.length > 0 && <Separator />}
          <details className="group/details">
            <summary className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-2 cursor-pointer select-none list-none">
              <ChevronRight className="size-3.5 transition-transform group-open/details:rotate-90" />
              Completed ({completed.length})
            </summary>
            <div className="flex flex-col gap-4 mt-3">
              {completed.map((booking) => (
                <BookingCard key={booking.id} booking={booking} />
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
