"use client";

import { useMemo } from "react";
import { ChevronRight, Plus, CalendarCheck } from "lucide-react";
import type { AirspaceCheck, Listing } from "@/db/schema";
import type { BookingStage } from "@/lib/bookingStages";
import type { BookingShooter } from "@/lib/shooterReads";
import { BookingCard } from "./BookingCard";
import { BookingForm } from "./BookingForm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatPrice } from "@/lib/format";
import { sumRevenue } from "./bookingMath";
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
  // Booked, but the day isn't settled: jobDate is a placeholder or empty.
  dateTentative: boolean;
  lockboxCode: string | null;
  notes: string | null;
  invoiceNote: string | null;
  /** Where the job is: tentative → scheduled → editing → invoice_sent → completed (paid). See src/lib/bookingStages.ts. */
  stage: BookingStage;
  completedAt: Date | null;
  // Shot, still editing: the photos haven't gone out yet.
  shotAt: Date | null;
  // Set once the invoice has been sent to the client (implies completedAt).
  invoiceSentAt: Date | null;
  // Recorded on completion — see CompleteBookingDialog.
  editingHours: number | null;
  shootingHours: number | null;
  logisticsHours: number | null;
  // This job's share of its trips' drive time, null when no trip is logged.
  driveHours: number | null;
  // Its share of the trips' gas and its linked expenses — see src/lib/finance.
  costs: BookingCosts;
  createdAt: Date;
  contactName: string | null;
  contactPhone: string | null;
  // When he last reached out to the contact, for chasing a date.
  contactLastContactedAt: Date | null;
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
  /** The gallery's share link for non-clients (null until first copied). */
  shareToken: string | null;
  stagingRequestsEnabled: boolean;
  hidePayOnline: boolean;
  // The invoice's Square copy, the client's "Pay Online", and when they paid
  // it — see src/lib/squareInvoice.ts.
  squareInvoiceUrl: string | null;
  paidAt: Date | null;
  // Whether the drone needs ATC authorization at the address — see
  // src/lib/airspace.ts. Null when there's no street address, the check
  // hasn't run yet, or it failed (then airspaceCheckedAt is set).
  airspace: AirspaceCheck | null;
  airspaceCheckedAt: Date | null;
  // The subcontracted photographer on this job, if any (Portland jobs), with
  // their agreed pay and whether it's been paid — see src/lib/shooters.ts.
  shooter: BookingShooter | null;
}

export interface BookingCosts {
  miles: number;
  gas: number;
  expenses: number;
  mileageDeduction: number;
  trips: { id: string; date: string; purpose: string; miles: number; driveMinutes: number | null; jobs: number }[];
  expenseItems: { id: string; date: string; description: string; amount: number; deductiblePercent: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function BookedList({ bookings }: { bookings: BookingWithDetails[] }) {
  // The split lives in ./data so the iPhone app's GET /bookings returns the
  // same buckets rather than a second opinion on what "waiting" means.
  const { tentative, scheduled, editing, waiting, completed } = useMemo(() => groupBookings(bookings), [bookings]);

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

      <BookingStats completed={completed} waiting={waiting} />

      <BookingSection
        title="Tentative"
        hint="They&rsquo;ve said yes, but the day isn&rsquo;t settled. Longest since you were last in touch first."
        bookings={tentative}
        defaultOpen
      />
      <BookingSection title="Scheduled" hint="Date confirmed, not shot yet. Soonest first." bookings={scheduled} defaultOpen />
      <BookingSection
        title="Editing"
        hint="Shot, but the gallery and invoice haven&rsquo;t gone out yet. Longest waiting first."
        bookings={editing}
        defaultOpen
      />
      <BookingSection
        title="Invoice sent"
        hint="Waiting for payment. Longest waiting first."
        bookings={waiting}
        totalSuffix="outstanding"
        defaultOpen
      />
      <BookingSection title="Completed" hint="Paid." bookings={completed} />
    </div>
  );
}

/** A collapsible stage bucket; the header total is the bucket's revenue (line items). */
function BookingSection({
  title,
  hint,
  bookings,
  totalSuffix,
  defaultOpen = false,
}: {
  title: string;
  hint?: string;
  bookings: BookingWithDetails[];
  totalSuffix?: string;
  defaultOpen?: boolean;
}) {
  if (bookings.length === 0) return null;
  return (
    <details className="group/details" open={defaultOpen}>
      <summary className="flex items-center gap-1 text-xs font-medium text-muted-foreground cursor-pointer select-none list-none">
        <ChevronRight className="size-3.5 transition-transform group-open/details:rotate-90" />
        {title} ({bookings.length})
        <span className="ml-auto text-foreground">
          {formatPrice(sumRevenue(bookings))}
          {totalSuffix && <span className="font-normal text-muted-foreground"> {totalSuffix}</span>}
        </span>
      </summary>
      {hint && <p className="text-xs text-muted-foreground mt-1.5 ml-4.5">{hint}</p>}
      <div className="flex flex-col gap-4 mt-3">
        {bookings.map((booking) => (
          <BookingCard key={booking.id} booking={booking} />
        ))}
      </div>
    </details>
  );
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/**
 * Revenue only (line-item totals); profit lives on Finances. Earned counts
 * completed (paid) jobs. "Last 30 days" goes by the job date, not when it was
 * paid — older jobs entered after the fact were all completed the day they
 * were backfilled. Outstanding is what's invoiced but not paid yet.
 */
function BookingStats({ completed, waiting }: { completed: BookingWithDetails[]; waiting: BookingWithDetails[] }) {
  const stats = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- a render-time "now" is fine for a rolling window
    const cutoff = Date.now() - 30 * DAY_MS;
    const recent = completed.filter((b) => (b.jobDate ?? b.paidAt ?? b.completedAt ?? b.createdAt).getTime() >= cutoff);
    const allTime = sumRevenue(completed);
    return {
      recentCount: recent.length,
      recent: sumRevenue(recent),
      allTimeCount: completed.length,
      allTime,
      average: completed.length > 0 ? allTime / completed.length : null,
      outstanding: sumRevenue(waiting),
      outstandingCount: waiting.length,
    };
  }, [completed, waiting]);

  return (
    <Card className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4">
      <Stat label="Last 30 days">
        {formatPrice(stats.recent)}
        <Sub>revenue · {plural(stats.recentCount, "job")}</Sub>
      </Stat>
      <Stat label="All time">
        {formatPrice(stats.allTime)}
        <Sub>revenue · {plural(stats.allTimeCount, "job")}</Sub>
      </Stat>
      <Stat label="Avg per job">
        {formatPrice(stats.average)}
        <Sub>revenue</Sub>
      </Stat>
      <Stat label="Outstanding">
        {formatPrice(stats.outstanding)}
        <Sub>{stats.outstandingCount > 0 ? `${plural(stats.outstandingCount, "invoice")} unpaid` : "nothing unpaid"}</Sub>
      </Stat>
    </Card>
  );
}
