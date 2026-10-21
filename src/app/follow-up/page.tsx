import { Suspense } from "react";
import { listingCountsByAgent, listingDatesByAgent } from "@/app/agents/actions";
import { AgentsSkeleton } from "@/app/agents/loading";
import { getFollowUpBoard } from "./data";
import { buildFeeds, getOfferFeeds } from "./feeds";
import { FollowUpList } from "./FollowUpList";

/**
 * Everyone Lukas knows who is due to hear from him, as feeds: one tab per
 * reason or offer (see feeds/index.ts and getFollowUpBoard). Its own page so it can take Pipeline's
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
  const [board, offers, counts, dates] = await Promise.all([
    getFollowUpBoard(),
    getOfferFeeds(),
    listingCountsByAgent(),
    listingDatesByAgent(),
  ]);
  const feeds = buildFeeds(board, offers);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Follow up</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Agents you know with a reason to hear from you, one feed per reason. Nobody shows up within 10 days of your
          last text, and each follow-up that goes unanswered doubles the wait.
        </p>
      </header>
      <FollowUpList feeds={feeds} upcoming={board.upcoming} stats={board.stats} counts={counts} dates={dates} />
    </>
  );
}
