import { Skeleton } from "@/components/ui/skeleton";
import { LeadCardSkeleton } from "../LeadCardSkeleton";

// Shared with page.tsx's <Suspense> fallback so hard navigations (this
// file) and soft client navigations (the in-page boundary) show the exact
// same skeleton instead of a visual mismatch between the two.
export function PipelineSkeleton() {
  return (
    <>
      <header className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-4 w-40" />
      </header>
      <div className="flex flex-col gap-4">
        <LeadCardSkeleton />
        <LeadCardSkeleton />
        <LeadCardSkeleton />
      </div>
    </>
  );
}

export default function PipelineLoading() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <PipelineSkeleton />
    </main>
  );
}
