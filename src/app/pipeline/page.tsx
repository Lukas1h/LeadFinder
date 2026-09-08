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
  // Cached so switching back to this tab is instant instead of re-showing
  // the loading skeleton every time — every mutation that touches this
  // data already calls revalidatePath("/pipeline") (see src/app/actions.ts),
  // which busts this on the next visit, so it can't go stale in practice.
  "use cache";

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
  for (const a of allAgents) agentByPhone[a.phone] = a;

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
