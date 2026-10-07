import { withLastContactFromHistory } from "@/lib/agentLastContact";
import { Suspense } from "react";
import { db } from "@/db";
import { listings, agents, type Agent } from "@/db/schema";
import { and, ne, inArray, or } from "drizzle-orm";
import { getQueuedListingIds } from "@/lib/queueMessages";
import { getFollowUpAfterDays } from "@/lib/settings";
import { buildAgentLookups } from "@/lib/pipeline";
import { PipelineList } from "./PipelineList";
import { PipelineSkeleton } from "./loading";

export default function PipelinePage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<PipelineSkeleton />}>
        <PipelineContent />
      </Suspense>
    </main>
  );
}

async function PipelineContent() {
  // Deliberately NOT "use cache" — this is a single-user internal tool with
  // no real traffic to serve from a shared cache, and every "use cache"
  // page here was racking up billed Vercel ISR writes on every mutation's
  // revalidatePath (see src/app/actions.ts) plus every deploy's prerender.
  // Plain per-request rendering costs nothing extra at this scale and is
  // always correct, no revalidation bookkeeping required.

  // Independent of each other, so run them concurrently instead of paying
  // for sequential round trips to Neon.
  const queuedIds = await getQueuedListingIds();
  const [all, allAgents, followUpAfterDays] = await Promise.all([
    // "new" listings only appear here once a message is queued for them —
    // see getQueuedListingIds.
    db
      .select()
      .from(listings)
      .where(
        // "outreach" listings were only a reason to text the agent, not
        // something being pursued — they stay out (see LEAD_STATUSES).
        and(
          ne(listings.status, "outreach"),
          queuedIds.size > 0
            ? or(ne(listings.status, "new"), inArray(listings.id, [...queuedIds]))
            : ne(listings.status, "new")
        )
      ),
    db.select().from(agents),
    getFollowUpAfterDays(),
  ]);

  // Maps aren't valid props across the server/client boundary — plain
  // objects instead, converted back to a Map inside PipelineList where
  // findDuplicateAgentContact needs one.
  const contactAgents = await withLastContactFromHistory(allAgents);
  const lookups = buildAgentLookups(contactAgents);
  const agentByPhone: Record<string, Agent> = Object.fromEntries(lookups.byPhone);
  const agentByName: Record<string, Agent> = Object.fromEntries(lookups.byName);
  const agentById: Record<string, Agent> = Object.fromEntries(lookups.byId);

  const referencedIds = contactAgents
    .map((a) => a.lastContactedListingId)
    .filter((id): id is string => id != null);
  const referencedListings =
    referencedIds.length > 0
      ? await db
          .select({ id: listings.id, address: listings.address })
          .from(listings)
          .where(inArray(listings.id, referencedIds))
      : [];
  const addressById: Record<string, string | null> = {};
  for (const l of referencedListings) addressById[l.id] = l.address;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {all.length} lead{all.length === 1 ? "" : "s"} in progress
        </p>
      </header>

      <PipelineList
        listings={all}
        agentByPhone={agentByPhone}
        agentByName={agentByName}
        agentById={agentById}
        addressById={addressById}
        followUpAfterDays={followUpAfterDays}
        queuedListingIds={[...queuedIds]}
      />
    </>
  );
}
