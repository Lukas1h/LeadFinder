import { Skeleton } from "@/components/ui/skeleton";

function AgentCardSkeleton() {
  return (
    <div className="rounded-xl border p-4 flex items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="h-8 w-36" />
    </div>
  );
}

// Shared with page.tsx's <Suspense> fallback so hard navigations (this
// file) and soft client navigations (the in-page boundary) show the exact
// same skeleton instead of a visual mismatch between the two.
export function AgentsSkeleton() {
  return (
    <>
      <header className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-56" />
      </header>
      <div className="flex flex-col gap-4">
        <AgentCardSkeleton />
        <AgentCardSkeleton />
        <AgentCardSkeleton />
      </div>
    </>
  );
}

export default function AgentsLoading() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <AgentsSkeleton />
    </main>
  );
}
