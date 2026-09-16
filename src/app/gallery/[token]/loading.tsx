import { Skeleton } from "@/components/ui/skeleton";

export default function GalleryLoading() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-10 flex flex-col gap-8">
      <header className="flex flex-col items-center gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-40 mt-3" />
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    </main>
  );
}
