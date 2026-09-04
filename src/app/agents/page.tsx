import { Suspense } from "react";
import { Plus, Users, ChevronRight, RotateCcw } from "lucide-react";
import { db } from "@/db";
import { agents, type Agent } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ensureAgentsBackfilled, listingCountsByPhone } from "./actions";
import { AgentCard } from "./AgentCard";
import { ImportAgentForm } from "./ImportAgentForm";
import { daysSince } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AgentsSkeleton } from "./loading";

const DECLINED_RESURFACE_AFTER_DAYS = 30;

export default function AgentsPage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<AgentsSkeleton />}>
        <AgentsContent />
      </Suspense>
    </main>
  );
}

function byRecency(a: Agent, b: Agent) {
  const aTime = a.lastContactedAt?.getTime() ?? 0;
  const bTime = b.lastContactedAt?.getTime() ?? 0;
  if (aTime !== bTime) return bTime - aTime;
  return (a.name ?? a.phone).localeCompare(b.name ?? b.phone);
}

async function AgentsContent() {
  await ensureAgentsBackfilled();

  const [all, counts] = await Promise.all([
    db.select().from(agents).orderBy(desc(agents.createdAt)),
    listingCountsByPhone(),
  ]);

  const active = all.filter((a) => !a.declinedAt).sort(byRecency);
  const readyToReconnect = all
    .filter((a) => a.declinedAt && daysSince(a.declinedAt) >= DECLINED_RESURFACE_AFTER_DAYS)
    .sort((a, b) => daysSince(b.declinedAt!) - daysSince(a.declinedAt!));
  const recentlyDeclined = all
    .filter((a) => a.declinedAt && daysSince(a.declinedAt) < DECLINED_RESURFACE_AFTER_DAYS)
    .sort((a, b) => a.declinedAt!.getTime() - b.declinedAt!.getTime());

  function card(agent: Agent) {
    return <AgentCard key={agent.id} agent={agent} listingCount={counts[agent.phone] ?? 0} />;
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
        <div className="flex flex-col gap-8">
          <section>
            {active.length === 0 ? (
              <p className="text-muted-foreground/70 text-sm">No active agents right now.</p>
            ) : (
              <div className="flex flex-col gap-4">{active.map(card)}</div>
            )}
          </section>

          {readyToReconnect.length > 0 && (
            <section>
              <Separator className="mb-8" />
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-3">
                <RotateCcw className="size-3.5" />
                Ready to reconnect
              </h2>
              <p className="text-xs text-muted-foreground mb-3 -mt-2">
                Declined 30+ days ago — worth a check-in.
              </p>
              <div className="flex flex-col gap-4">{readyToReconnect.map(card)}</div>
            </section>
          )}

          {recentlyDeclined.length > 0 && (
            <section>
              <Separator className="mb-8" />
              <details className="group/details">
                <summary className="flex items-center gap-1 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 cursor-pointer select-none list-none">
                  <ChevronRight className="size-4 transition-transform group-open/details:rotate-90" />
                  Declined ({recentlyDeclined.length})
                </summary>
                <div className="flex flex-col gap-4 mt-3">{recentlyDeclined.map(card)}</div>
              </details>
            </section>
          )}
        </div>
      )}
    </>
  );
}
