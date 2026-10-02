import { Suspense } from "react";
import { connection } from "next/server";
import { Skeleton } from "@/components/ui/skeleton";
import { getQueue } from "./actions";
import { QueueList } from "./QueueList";

export default function QueuePage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <QueueContent />
      </Suspense>
    </main>
  );
}

async function QueueContent() {
  // Deliberately NOT "use cache" — see the comment in src/app/pipeline/page.tsx.
  // Due/not-due is read from the clock, so defer to request time.
  await connection();
  const items = await getQueue();
  return <QueueList items={items} />;
}
