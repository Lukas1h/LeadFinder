import { Suspense } from "react";
import { listingCountsByAgent, listingDatesByAgent } from "@/app/agents/actions";
import { AgentsSkeleton } from "@/app/agents/loading";
import { getFollowUpBoard } from "./data";
import { FollowUpList } from "./FollowUpList";

/**
 * Everyone Lukas knows who is due to hear from him, strongest reason first,
 * five a day (see getFollowUpBoard). Its own page so it can take Pipeline's
 * place next to Leads on mobile — the work is keeping relationships warm now,
 * not moving properties through stages.
 */
export default function FollowUpPage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<AgentsSkeleton />}>
        <FollowUpContent />
      </Suspense>
    </main>
  );
}

async function FollowUpContent() {
  const [board, counts, dates] = await Promise.all([
    getFollowUpBoard(),
    listingCountsByAgent(),
    listingDatesByAgent(),
  ]);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Follow up</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Five a day, strongest reason first: a new listing, samples that got no answer, a sale, a price cut, then
          anyone who&rsquo;s gone quiet. Each follow-up that goes unanswered doubles the wait. Text one, or snooze them
          for 4 weeks.
        </p>
      </header>
      <FollowUpList {...board} counts={counts} dates={dates} />
    </>
  );
}
