import { Suspense } from "react";
import { getFollowUpAgents, listingCountsByAgent, listingDatesByAgent } from "@/app/agents/actions";
import { AgentsSkeleton } from "@/app/agents/loading";
import { FollowUpList } from "./FollowUpList";

/**
 * Agents due for a check-in: warm, interested and past clients nobody has
 * heard from in four weeks (see getFollowUpAgents). The same list sits at the
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
  const [agents, counts, dates] = await Promise.all([
    getFollowUpAgents(),
    listingCountsByAgent(),
    listingDatesByAgent(),
  ]);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Follow up</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Agents you know who haven&rsquo;t heard from you in 4+ weeks. Text one, or snooze them for another 4.
        </p>
      </header>
      <FollowUpList agents={agents} counts={counts} dates={dates} />
    </>
  );
}
