import { Suspense } from "react";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { desc } from "drizzle-orm";
import { PhotoScoreTester } from "./PhotoScoreTester";
import { Skeleton } from "@/components/ui/skeleton";

export default function DevelopPage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Develop</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Internal tools for iterating on the app — not part of the day-to-day workflow.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <Suspense fallback={<Skeleton className="h-40 w-full rounded-lg" />}>
          <DevelopContent />
        </Suspense>
      </div>
    </main>
  );
}

async function DevelopContent() {
  const recentListings = await db
    .select({ id: listings.id, address: listings.address, photoCount: listings.photoCount })
    .from(listings)
    .orderBy(desc(listings.foundAt))
    .limit(100);

  return <PhotoScoreTester listings={recentListings} />;
}
