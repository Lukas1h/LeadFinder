import { Suspense } from "react";
import { db } from "@/db";
import { listings, agents, type Agent } from "@/db/schema";
import { ne, inArray } from "drizzle-orm";
import { getFollowUpAfterDays } from "@/lib/settings";
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
  const [all, allAgents, followUpAfterDays] = await Promise.all([
    db.select().from(listings).where(ne(listings.status, "new")),
    db.select().from(agents),
    getFollowUpAfterDays(),
  ]);

  // Maps aren't valid props across the server/client boundary — plain
  // objects instead, converted back to a Map inside PipelineList where
  // findDuplicateAgentContact needs one.
  const agentByPhone: Record<string, Agent> = {};
  for (const a of allAgents) if (a.phone) agentByPhone[a.phone] = a;

  const referencedIds = allAgents
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
        addressById={addressById}
        followUpAfterDays={followUpAfterDays}
      />
    </>
  );
}
