import { Suspense } from "react";
import { Plus, Users } from "lucide-react";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { desc, isNotNull, isNull, eq, ne, or, and, sql } from "drizzle-orm";
import { ensureAgentsBackfilled, listingCountsByAgent, listingDatesByAgent, getFollowUpAgents } from "./actions";
import { AgentsList } from "./AgentsList";
import { COLD_INITIAL_LIMIT } from "./constants";
import { ImportAgentForm } from "./ImportAgentForm";
import { Button } from "@/components/ui/button";
import { AgentsSkeleton } from "./loading";

export default function AgentsPage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<AgentsSkeleton />}>
        <AgentsContent />
      </Suspense>
    </main>
  );
}

async function AgentsContent() {
  // Deliberately NOT "use cache" — see the comment in src/app/pipeline/page.tsx.

  await ensureAgentsBackfilled();

  // "cold, never contacted" dwarfs every other bucket (thousands of rows
  // from the lead scrapers) and is the entire reason this page used to be
  // slow — fetching and shipping every one of them just to render 15 was
  // the real cost, not the render itself. Every other bucket (any real
  // relationship, or declined) is small and fetched in full; "cold" gets only
  // its most recent page, plus a count for the "View all" button — the rest
  // loads on demand (see getAllColdAgents).
  const isColdAndFresh = eq(agents.relationshipStatus, "cold");

  const [totalAgentCount, nonColdFresh, coldFreshPage, coldFreshTotal, counts, agentListings, followUp] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(agents),
    db
      .select()
      .from(agents)
      .where(ne(agents.relationshipStatus, "cold"))
      .orderBy(desc(agents.createdAt)),
    db.select().from(agents).where(isColdAndFresh).orderBy(desc(agents.createdAt)).limit(COLD_INITIAL_LIMIT),
    db.select({ count: sql<number>`count(*)::int` }).from(agents).where(isColdAndFresh),
    listingCountsByAgent(),
    listingDatesByAgent(),
    getFollowUpAgents(),
  ]);

  const all = [...nonColdFresh, ...coldFreshPage];

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalAgentCount[0].count.toLocaleString()} agent{totalAgentCount[0].count === 1 ? "" : "s"} —
            relationships tracked across listings, not just per-lead
          </p>
        </div>
        <ImportAgentForm
          trigger={
            <Button>
              <Plus />
              Import agent
            </Button>
          }
        />
      </header>

      {totalAgentCount[0].count === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <Users className="size-8" />
          <p>No agents yet — they&rsquo;ll show up here as leads come in, or import one manually.</p>
        </div>
      ) : (
        <AgentsList
          agents={all}
          counts={counts}
          listingDatesByAgent={agentListings}
          coldFreshTotal={coldFreshTotal[0].count}
          followUpAgents={followUp}
        />
      )}
    </>
  );
}
