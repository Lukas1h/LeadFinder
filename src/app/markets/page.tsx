import { Suspense } from "react";
import { connection } from "next/server";
import { KILL_MIN_SENDS, KILL_REPLY_RATE, loadMarketsOverview } from "./data";
import { MarketsSkeleton } from "./loading";
import { PerformanceTable } from "./PerformanceTable";
import { MarketCards } from "./MarketCards";
import { ShootersSection } from "./ShootersSection";
import { MarketDialog } from "./MarketDialog";

export default function MarketsPage() {
  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-10">
      <Suspense fallback={<MarketsSkeleton />}>
        <MarketsContent />
      </Suspense>
    </main>
  );
}

async function MarketsContent() {
  // Deliberately NOT "use cache" — see the comment in src/app/pipeline/page.tsx.
  await connection();
  const { markets, performance, unassigned, shooters } = await loadMarketsOverview();
  const hasOther =
    unassigned.listingsFound + unassigned.openListings + unassigned.coldSent + unassigned.bookings > 0 ||
    unassigned.revenue !== 0;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Markets</h1>
        <MarketDialog mode="create" />
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">Performance</h2>
        <PerformanceTable
          rows={hasOther ? [...performance, unassigned] : performance}
          killMinSends={KILL_MIN_SENDS}
          killReplyRate={KILL_REPLY_RATE}
        />
        <p className="text-xs text-muted-foreground">
          Cold texts (sent, replied, interested, reply rate) cover the last 30 days; listings, bookings and money the
          last 28. Open listings are as of now.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">Markets</h2>
        <MarketCards markets={markets} shooters={shooters} />
      </section>

      <section className="flex flex-col gap-2">
        <ShootersSection shooters={shooters} markets={markets.map((m) => ({ key: m.key, label: m.label }))} />
      </section>
    </div>
  );
}
