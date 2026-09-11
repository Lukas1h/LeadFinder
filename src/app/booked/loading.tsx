import { Skeleton } from "@/components/ui/skeleton";
import { LeadCardSkeleton } from "../LeadCardSkeleton";

// Shared with page.tsx's <Suspense> fallback — see the matching comment in
// src/app/pipeline/loading.tsx.
export function BookedSkeleton() {
  return (
    <>
      <header className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-4 w-32" />
      </header>
      <div className="flex flex-col gap-4">
        <LeadCardSkeleton />
        <LeadCardSkeleton />
      </div>
    </>
  );
}

export default function BookedLoading() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <BookedSkeleton />
    </main>
  );
}
