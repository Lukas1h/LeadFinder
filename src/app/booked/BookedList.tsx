"use client";

import { useMemo } from "react";
import { ChevronRight, Plus, CalendarCheck } from "lucide-react";
import type { Listing } from "@/db/schema";
import { BookingCard } from "./BookingCard";
import { BookingForm } from "./BookingForm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatPrice } from "@/lib/format";
import { averageProfitPerHour, sumProfit } from "./bookingMath";
import { groupBookings } from "./data";
import { Stat, Sub } from "../Stat";

export interface BookingWithDetails {
  id: string;
  listingId: string | null;
  // The agents row behind contactName/contactPhone, for callers that want to
  // jump from a booking to the agent (the iPhone app does; the web reads it
  // off the card's own dialog instead).
  contactAgentId: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  // Full row of the linked listing (for the ListingRow reference card),
  // null for a manual booking with no tracked listing at all.
  listing: Listing | null;
  jobDate: Date | null;
  lockboxCode: string | null;
  notes: string | null;
  invoiceNote: string | null;
  completedAt: Date | null;
  // Set once the invoice has been sent to the client (implies completedAt).
  invoiceSentAt: Date | null;
  // Recorded on completion — see CompleteBookingDialog.
  driveHours: number | null;
  editingHours: number | null;
  shootingHours: number | null;
  logisticsHours: number | null;
  additionalCosts: number | null;
  createdAt: Date;
  contactName: string | null;
  contactPhone: string | null;
  lineItems: { description: string; amount: number }[];
  // Rough "~1h 15m drive" from the home location set in Settings — see
  // src/lib/driveTime.ts. Null if either city isn't in its coordinate
  // table (no address on file, or an unrecognized city).
  driveTime: string | null;
  // Null until "Create invoice" is first clicked (see the invoice route,
  // src/app/api/bookings/[id]/invoice/route.ts) — lets the UI show
  // "View invoice" vs "Create invoice" without a separate fetch.
  invoiceNumber: number | null;
  invoicedAt: Date | null;
  // The Dropbox folder photos were delivered into, and the resulting
  // client-facing gallery's token (null until "Get client gallery link" is
  // first clicked) — see src/app/gallery/[token]/page.tsx.
  dropboxFolderLink: string | null;
  galleryToken: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function BookedList({ bookings }: { bookings: BookingWithDetails[] }) {
  // The split lives in ./data so the iPhone app's GET /bookings returns the
  // same buckets rather than a second opinion on what "waiting" means.
  const { upcoming, waiting, completed } = useMemo(() => groupBookings(bookings), [bookings]);

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

      <BookingStats completed={completed} />

      <BookingSection title="In progress" bookings={upcoming} defaultOpen />
      <BookingSection title="Invoice sent" bookings={waiting} />
      <BookingSection title="Completed" bookings={completed} />
    </div>
  );
}

function BookingSection({
  title,
  bookings,
  defaultOpen = false,
}: {
  title: string;
  bookings: BookingWithDetails[];
  defaultOpen?: boolean;
}) {
  if (bookings.length === 0) return null;
  return (
    <details className="group/details" open={defaultOpen}>
      <summary className="flex items-center gap-1 text-xs font-medium text-muted-foreground cursor-pointer select-none list-none">
        <ChevronRight className="size-3.5 transition-transform group-open/details:rotate-90" />
        {title} ({bookings.length})
        <span className="ml-auto text-foreground">{formatPrice(sumProfit(bookings))}</span>
      </summary>
      <div className="flex flex-col gap-4 mt-3">
        {bookings.map((booking) => (
          <BookingCard key={booking.id} booking={booking} />
        ))}
      </div>
    </details>
  );
}

/**
 * Counts only completed (paid) bookings — money that's actually in hand.
 * "Last 30 days" goes by the job date, not when it was marked completed —
 * older jobs entered after the fact were all completed on the day they
 * were backfilled. Falls back to completedAt for a booking with no job date.
 */
function BookingStats({ completed }: { completed: BookingWithDetails[] }) {
  const stats = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- a render-time "now" is fine for a rolling window
    const cutoff = Date.now() - 30 * DAY_MS;
    const recent = completed.filter((b) => (b.jobDate ?? b.completedAt!).getTime() >= cutoff);
    const allTimeProfit = sumProfit(completed);
    return {
      recentCount: recent.length,
      recentProfit: sumProfit(recent),
      allTimeCount: completed.length,
      allTimeProfit,
      average: completed.length > 0 ? allTimeProfit / completed.length : null,
      perHour: averageProfitPerHour(completed),
    };
  }, [completed]);

  return (
    <Card className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4">
      <Stat label="Last 30 days">
        {formatPrice(stats.recentProfit)}
        <Sub>{stats.recentCount} {stats.recentCount === 1 ? "booking" : "bookings"}</Sub>
      </Stat>
      <Stat label="All time">
        {formatPrice(stats.allTimeProfit)}
        <Sub>{stats.allTimeCount} {stats.allTimeCount === 1 ? "booking" : "bookings"}</Sub>
      </Stat>
      <Stat label="Avg per booking">
        {formatPrice(stats.average)}
        <Sub>profit</Sub>
      </Stat>
      <Stat label="Avg per hour">
        {stats.perHour != null ? `${formatPrice(stats.perHour)}/hr` : "—"}
        <Sub>{stats.perHour != null ? "profit" : "no hours recorded"}</Sub>
      </Stat>
    </Card>
  );
}
