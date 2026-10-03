import { Skeleton } from "@/components/ui/skeleton";

// Shared with page.tsx's <Suspense> fallback so hard navigations (this
// file) and soft client navigations (the in-page boundary) show the exact
// same skeleton instead of a visual mismatch between the two.
export function PresetsSkeleton() {
  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2 flex-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </header>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    </>
  );
}

export default function PresetsLoading() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <PresetsSkeleton />
    </main>
  );
}
