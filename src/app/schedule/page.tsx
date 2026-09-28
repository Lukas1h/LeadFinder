import { Suspense } from "react";
import { connection } from "next/server";
import { todayScheduleDate } from "@/lib/schedule";
import { loadScheduleItems } from "@/lib/scheduleItems";
import { ScheduleList } from "./ScheduleList";
import { ScheduleSkeleton } from "./loading";

export default function SchedulePage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<ScheduleSkeleton />}>
        <ScheduleContent />
      </Suspense>
    </main>
  );
}

async function ScheduleContent() {
  // Deliberately NOT "use cache" — see the comment in src/app/pipeline/page.tsx.
  // "Today" is read from the clock, which Cache Components won't allow in a
  // prerender — connection() defers this component to request time.
  await connection();
  const today = todayScheduleDate();
  const items = await loadScheduleItems(today);

  return <ScheduleList items={items} today={today} />;
}
