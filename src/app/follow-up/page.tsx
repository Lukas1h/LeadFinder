import { Suspense } from "react";
import { listingCountsByAgent, listingDatesByAgent } from "@/app/agents/actions";
import { AgentsSkeleton } from "@/app/agents/loading";
import { getFollowUpBoard } from "./data";
import { FollowUpList } from "./FollowUpList";

/**
 * Agents due for a check-in: clients and interested agents who just listed,
 * then everyone Lukas knows who has gone quiet (see getFollowUpBoard). The same list sits at the
 * top of the Agents tab; this is its own page so it can take Pipeline's place
 * next to Leads on mobile — the work is keeping relationships warm now, not
 * moving properties through stages.
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
  const [{ justListed, agents }, counts, dates] = await Promise.all([
    getFollowUpBoard(),
    listingCountsByAgent(),
    listingDatesByAgent(),
  ]);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Follow up</h1>
        <p className="text-sm text-muted-foreground mt-1">
          New listings from people who know you, then anyone who&rsquo;s gone quiet: interested agents after 2 weeks,
          everyone else after 4. Text one, or snooze them for 4 weeks.
        </p>
      </header>
      <FollowUpList justListed={justListed} agents={agents} counts={counts} dates={dates} />
    </>
  );
}
