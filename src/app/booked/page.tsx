import { Suspense } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { BookedList } from "./BookedList";
import { BookedSkeleton } from "./loading";
import { loadBookingsWithDetails } from "./data";

export default function BookedPage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<BookedSkeleton />}>
        <BookedContent />
      </Suspense>
    </main>
  );
}

async function BookedContent() {
  // Deliberately NOT "use cache" — see the comment in src/app/pipeline/page.tsx.

  const withDetails = await loadBookingsWithDetails();

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Booked</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {withDetails.length} job{withDetails.length === 1 ? "" : "s"} on the books
          </p>
        </div>
        <Link
          href="/finances"
          className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <Wallet className="size-4" />
          Finances
        </Link>
      </header>

      <BookedList bookings={withDetails} />
    </>
  );
}
