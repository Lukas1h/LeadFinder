import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function LeadCardSkeleton() {
  return (
    <Card className="flex-col sm:flex-row gap-4 p-4">
      <Skeleton className="shrink-0 w-full sm:w-40 h-40 sm:h-32 rounded-lg" />
      <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
    </Card>
  );
}
