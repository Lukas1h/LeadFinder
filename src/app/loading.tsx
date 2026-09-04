import { Skeleton } from "@/components/ui/skeleton";
import { LeadCardSkeleton } from "./LeadCardSkeleton";

export default function LeadsLoading() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-24" />
      </header>
      <div className="flex flex-col gap-4">
        <LeadCardSkeleton />
        <LeadCardSkeleton />
        <LeadCardSkeleton />
      </div>
    </main>
  );
}
