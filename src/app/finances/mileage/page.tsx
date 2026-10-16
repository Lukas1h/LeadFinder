import { Suspense } from "react";
import { connection } from "next/server";
import { FinanceSkeleton } from "../loading";
import { loadLedger } from "@/lib/finance/ledger";
import { pacificDate } from "@/lib/finance/math";
import { mileageReport } from "@/lib/finance/reports";
import { TripList } from "./TripList";

export default function FinanceMileagePage() {
  return (
    <Suspense fallback={<FinanceSkeleton />}>
      <Mileage />
    </Suspense>
  );
}

async function Mileage() {
  await connection();
  const report = mileageReport(await loadLedger(), pacificDate(new Date()));

  return <TripList report={report} />;
}
