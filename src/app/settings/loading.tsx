import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-10 w-24" />
      </header>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </main>
  );
}
