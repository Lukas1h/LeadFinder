import { Skeleton } from "@/components/ui/skeleton";

export default function PresetsLoading() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <header className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-md" />
        <Skeleton className="h-4 w-2/3 max-w-sm" />
      </header>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </main>
  );
}
