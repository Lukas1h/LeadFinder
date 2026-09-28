import { Skeleton } from "@/components/ui/skeleton";

// Shared with page.tsx's <Suspense> fallback — see the matching comment in
// src/app/pipeline/loading.tsx.
export function ScheduleSkeleton() {
  return (
    <>
      <header className="mb-6 flex items-center justify-between gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-32" />
      </header>
      <div className="flex flex-col gap-6">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </>
  );
}

export default function ScheduleLoading() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <ScheduleSkeleton />
    </main>
  );
}
