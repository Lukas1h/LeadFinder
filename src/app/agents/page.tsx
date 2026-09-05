import { Suspense } from "react";
import { Plus, Users } from "lucide-react";
import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { desc, isNotNull } from "drizzle-orm";
import { ensureAgentsBackfilled, listingCountsByPhone } from "./actions";
import { AgentsList } from "./AgentsList";
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
  await ensureAgentsBackfilled();

  const [all, counts, agentListings] = await Promise.all([
    db.select().from(agents).orderBy(desc(agents.createdAt)),
    listingCountsByPhone(),
    db.select().from(listings).where(isNotNull(listings.agentPhone)),
  ]);

  const listingsByPhone: Record<string, typeof agentListings> = {};
  for (const l of agentListings) {
    if (!l.agentPhone) continue;
    (listingsByPhone[l.agentPhone] ??= []).push(l);
  }
  for (const phone in listingsByPhone) {
    listingsByPhone[phone].sort((a, b) => {
      const aTime = (a.listedAt ?? a.foundAt).getTime();
      const bTime = (b.listedAt ?? b.foundAt).getTime();
      return bTime - aTime;
    });
  }

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {all.length} agent{all.length === 1 ? "" : "s"} — relationships tracked across listings,
            not just per-lead
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

      {all.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <Users className="size-8" />
          <p>No agents yet — they&rsquo;ll show up here as leads come in, or import one manually.</p>
        </div>
      ) : (
        <AgentsList agents={all} counts={counts} listingsByPhone={listingsByPhone} />
      )}
    </>
  );
}
