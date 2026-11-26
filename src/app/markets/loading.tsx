import { Skeleton } from "@/components/ui/skeleton";

export function MarketsSkeleton() {
  return (
    <>
      <header className="mb-6 flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-28" />
      </header>
      <Skeleton className="h-48 w-full rounded-lg mb-8" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    </>
  );
}

export default function MarketsLoading() {
  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-10">
      <MarketsSkeleton />
    </main>
  );
}
