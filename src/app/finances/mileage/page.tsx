import { Suspense } from "react";
import { connection } from "next/server";
import { FinanceSkeleton } from "../loading";
import { loadLedger } from "@/lib/finance/ledger";
import { pacificDate, tripCost } from "@/lib/finance/math";
import { mileageRate } from "@/lib/finance/tax";
import { TripList, type TripRow } from "./TripList";

export default function FinanceMileagePage() {
  return (
    <Suspense fallback={<FinanceSkeleton />}>
      <Mileage />
    </Suspense>
  );
}

async function Mileage() {
  await connection();
  const ledger = await loadLedger();
  const labelById = new Map(ledger.bookings.map((b) => [b.id, b.label]));
  const year = pacificDate(new Date()).slice(0, 4);

  const trips: TripRow[] = ledger.trips
    .map((t) => {
      const cost = tripCost(t, ledger);
      return {
        ...t,
        gas: cost.gas,
        pricePerGallon: cost.pricePerGallon,
        rate: mileageRate(t.date),
        deduction: cost.mileageDeduction,
        jobLabels: t.bookingIds.map((id) => labelById.get(id) ?? "Booking"),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return <TripList trips={trips} year={year} mpg={ledger.mpg} />;
}
