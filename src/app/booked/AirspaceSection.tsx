"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plane, TriangleAlert, RefreshCw } from "lucide-react";
import { recheckBookingAirspace } from "./actions";
import { Button } from "@/components/ui/button";
import type { BookingWithDetails } from "./BookedList";

// The FAA's own pages: DroneZone for the requests LAANC can't do, and how LAANC works.
const DRONEZONE_URL = "https://faadronezone-access.faa.gov/";
const LAANC_INFO_URL = "https://www.faa.gov/uas/getting_started/laanc";

/** "Class D airspace" for the booking card, or null when the drone can fly there freely. */
export function airspaceBadgeLabel(booking: Pick<BookingWithDetails, "airspace">): string | null {
  const check = booking.airspace;
  if (check?.status !== "controlled") return null;
  const cls = check.airspaces[0]?.class;
  return cls ? `Class ${cls} airspace` : "Controlled airspace";
}

/**
 * The booking detail's drone airspace line (see src/lib/airspace.ts). Loud
 * only when the spot needs ATC authorization: then the summary, the facility
 * map's ceiling, whether LAANC is offered, and where to file. Uncontrolled is
 * one muted line. Nothing at all without a street address.
 */
export function AirspaceSection({ booking }: { booking: BookingWithDetails }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const check = booking.airspace;

  if (!booking.address) return null;

  const recheck = () => {
    startTransition(async () => {
      const result = await recheckBookingAirspace(booking.id);
      if ("error" in result) toast.error(result.error);
      else toast.success(result.summary);
      router.refresh();
    });
  };

  const checkAgain = (
    <Button variant="ghost" size="xs" onClick={recheck} disabled={isPending} className="text-muted-foreground">
      <RefreshCw className={isPending ? "animate-spin" : undefined} />
      {isPending ? "Checking…" : "Check again"}
    </Button>
  );

  if (!check) {
    return (
      <div className="border-t pt-3 flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Plane className="size-3.5" />
          {booking.airspaceCheckedAt ? "Couldn't check the drone airspace." : "Drone airspace not checked yet."}
        </span>
        {checkAgain}
      </div>
    );
  }

  if (check.status === "uncontrolled") {
    return (
      <div className="border-t pt-3 flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="flex items-start gap-1.5">
          <Plane className="size-3.5 shrink-0 mt-0.5" />
          {check.summary}
        </span>
        {checkAgain}
      </div>
    );
  }

  const airport = check.airport ? `${check.airport.name} (${check.airport.id})` : null;
  const details = [
    check.ceilingFt != null ? `FAA map ceiling ${check.ceilingFt} ft` : null,
    check.laanc === true ? `LAANC available${airport ? ` at ${airport}` : ""}` : null,
    check.laanc === false ? `No LAANC${airport ? ` at ${airport}` : ""}` : null,
  ].filter(Boolean);

  return (
    <div className="border-t pt-3">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex flex-col gap-1.5">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
          <TriangleAlert className="size-4 shrink-0 mt-0.5" />
          {check.summary}
        </p>
        {details.length > 0 && <p className="text-xs text-amber-800/80 dark:text-amber-300/80 pl-5.5">{details.join(" · ")}</p>}
        <div className="flex items-center justify-between gap-2 pl-5.5">
          <span className="text-xs flex gap-3">
            <a href={DRONEZONE_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-amber-800 dark:text-amber-300">
              FAA DroneZone
            </a>
            <a href={LAANC_INFO_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-amber-800 dark:text-amber-300">
              About LAANC
            </a>
          </span>
          {checkAgain}
        </div>
      </div>
    </div>
  );
}
