"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Car, Clock, Plus, Receipt } from "lucide-react";
import { addBookingToTrip, getLinkOptions, type LinkOptions } from "@/app/finances/actions";
import { TripDialog, blankTrip } from "@/app/finances/TripDialog";
import { ExpenseDialog, blankExpense } from "@/app/finances/ExpenseDialog";
import { pacificDate } from "@/lib/finance/math";
import { formatPrice } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { COMPLETION_FIELDS, bookingProfit, profitPerHour } from "./bookingMath";
import type { BookingWithDetails } from "./BookedList";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * The booking's time and money: hours, its trip (miles, drive time, gas),
 * expenses charged to it, and what it actually made. Logging a trip or an
 * expense from here links it to this job.
 */
export function BookingMoney({ booking, open }: { booking: BookingWithDetails; open: boolean }) {
  const router = useRouter();
  const [tripOpen, setTripOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [options, setOptions] = useState<LinkOptions | null>(null);

  const { costs } = booking;
  const day = booking.jobDate ? pacificDate(booking.jobDate) : pacificDate(new Date());
  const hasTrip = costs.trips.length > 0;

  // A two-job day is one drive: offer the day's trip before a new one.
  useEffect(() => {
    if (open && !hasTrip) getLinkOptions().then(setOptions);
  }, [open, hasTrip]);
  const sameDayTrips = hasTrip ? [] : (options?.trips ?? []).filter((t) => t.date === day);

  const total = booking.lineItems.reduce((sum, li) => sum + li.amount, 0);
  const hourlyRate = profitPerHour(booking);
  const recorded = COMPLETION_FIELDS.filter(({ key }) => booking[key] != null);
  const hasCosts = hasTrip || costs.expenseItems.length > 0;
  const location = [booking.address, booking.city, booking.state].filter(Boolean).join(", ");

  const joinTrip = async (tripId: string) => {
    await addBookingToTrip(tripId, booking.id);
    toast.success("Added to the trip");
    router.refresh();
  };

  return (
    <div className="border-t pt-3">
      <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
        <Clock className="size-3.5" />
        Time &amp; money
      </p>
      <div className="flex flex-col gap-1">
        {recorded.map(({ key, label }) => (
          <Row key={key} label={label} value={`${booking[key]} h`} />
        ))}
        {booking.driveHours != null && booking.driveHours > 0 && (
          <Row label="Driving" value={`${Math.round(booking.driveHours * 100) / 100} h`} />
        )}

        {costs.trips.map((t) => (
          <Row
            key={t.id}
            icon={<Car className="size-3.5 shrink-0" />}
            label={`${dayLabel(t.date)} · ${Math.round(t.miles)} mi${t.jobs > 1 ? `, split with ${t.jobs - 1} other job${t.jobs > 2 ? "s" : ""}` : ""}`}
            value=""
            muted
          />
        ))}
        {hasTrip && <Row label="Gas" value={`−${money(costs.gas)}`} />}
        {costs.expenseItems.map((e) => (
          <Row key={e.id} label={e.description} value={`−${money(e.amount)}`} />
        ))}

        {(hasCosts || recorded.length > 0) && (
          <>
            <div className="flex items-center justify-between text-sm font-semibold border-t pt-1 mt-1">
              <span>Profit</span>
              <span>{formatPrice(hasCosts ? bookingProfit(booking) : total)}</span>
            </div>
            {hourlyRate != null && (
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>Per hour</span>
                <span>{formatPrice(hourlyRate)}/hr</span>
              </div>
            )}
            {hasTrip && (
              <p className="text-xs text-muted-foreground">
                Mileage deduction {money(costs.mileageDeduction)} ({Math.round(costs.miles)} mi)
              </p>
            )}
          </>
        )}

        {sameDayTrips.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground truncate">
              Same drive as {t.purpose}? ({Math.round(t.miles)} mi)
            </span>
            <Button size="sm" variant="outline" onClick={() => joinTrip(t.id)}>
              Add to it
            </Button>
          </div>
        ))}

        <div className="flex flex-wrap gap-2 mt-1.5">
          {!hasTrip && (
            <Button size="sm" variant="outline" onClick={() => setTripOpen(true)}>
              <Plus />
              Log the trip
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setExpenseOpen(true)}>
            <Receipt />
            Add an expense
          </Button>
        </div>
      </div>

      <TripDialog
        draft={blankTrip({
          date: day,
          purpose: `Shoot${booking.contactName ? ` for ${booking.contactName}` : ""}${location ? `, ${location}` : ""}`,
          stops: location,
          bookingIds: [booking.id],
        })}
        open={tripOpen}
        onOpenChange={setTripOpen}
      />
      <ExpenseDialog
        draft={blankExpense({ date: day, bookingId: booking.id })}
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
      />
    </div>
  );
}

function Row({ label, value, icon, muted }: { label: string; value: string; icon?: React.ReactNode; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-sm gap-3 ${muted ? "text-muted-foreground" : ""}`}>
      <span className={`flex items-center gap-1.5 truncate ${muted ? "" : "text-foreground/90"}`}>
        {icon}
        {label}
      </span>
      {value && <span className="text-foreground shrink-0">{value}</span>}
    </div>
  );
}
