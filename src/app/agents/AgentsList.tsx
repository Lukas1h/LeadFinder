"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, RotateCcw, ChevronRight } from "lucide-react";
import type { Agent, AgentRelationshipStatus, Listing } from "@/db/schema";
import { daysSince } from "@/lib/format";
import { AgentCard, RELATIONSHIP_LABELS } from "./AgentCard";
import { AgentDetailDialog } from "./AgentDetailDialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

const DECLINED_RESURFACE_AFTER_DAYS = 30;

// Most-established relationship first — mirrors the natural progression
// (see bumpAgentRelationshipOnMilestone in src/app/actions.ts).
const RELATIONSHIP_ORDER: AgentRelationshipStatus[] = [
  "regular",
  "worked_once",
  "interested",
  "warm",
  "cold",
];

function byRecency(a: Agent, b: Agent) {
  const aTime = a.lastContactedAt?.getTime() ?? 0;
  const bTime = b.lastContactedAt?.getTime() ?? 0;
  if (aTime !== bTime) return bTime - aTime;
  return (a.name ?? a.phone ?? a.email ?? "").localeCompare(b.name ?? b.phone ?? b.email ?? "");
}

function matchesSearch(agent: Agent, query: string): boolean {
  if (!query) return true;
  if (agent.name?.toLowerCase().includes(query)) return true;
  if (agent.email?.toLowerCase().includes(query)) return true;
  if (agent.phone?.toLowerCase().includes(query)) return true;
  const digits = query.replace(/\D/g, "");
  if (digits && agent.phone?.replace(/\D/g, "").includes(digits)) return true;
  return false;
}

export function AgentsList({
  agents,
  counts,
  listingsByPhone,
}: {
  agents: Agent[];
  counts: Record<string, number>;
  listingsByPhone: Record<string, Listing[]>;
}) {
  const [search, setSearch] = useState("");

  // Deep-link from ListingModal's agent block (?agent=<phone>) — opens that
  // agent's detail dialog directly, regardless of which section/collapsed
  // group they'd normally be found in below.
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkedPhone = searchParams.get("agent");
  const linkedAgent = linkedPhone ? agents.find((a) => a.phone === linkedPhone) : undefined;

  // Keeps the last-linked agent's data around through the dialog's close
  // animation instead of unmounting (and losing its content) the instant
  // the URL param clears — the standard "adjust state during render"
  // pattern, not an effect, so it commits before paint.
  const [displayedAgent, setDisplayedAgent] = useState(linkedAgent);
  if (linkedAgent && linkedAgent !== displayedAgent) setDisplayedAgent(linkedAgent);

  const handleLinkedDialogOpenChange = (open: boolean) => {
    if (!open) router.replace("/agents", { scroll: false });
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return agents.filter((a) => matchesSearch(a, query));
  }, [agents, search]);

  const { byStatus, readyToReconnect, recentlyDeclined } = useMemo(() => {
    const notDeclined = filtered.filter((a) => !a.declinedAt);
    const groups: Record<AgentRelationshipStatus, Agent[]> = {
      cold: [],
      warm: [],
      interested: [],
      worked_once: [],
      regular: [],
    };
    for (const a of notDeclined) groups[a.relationshipStatus].push(a);
    for (const status of RELATIONSHIP_ORDER) groups[status].sort(byRecency);

    return {
      byStatus: groups,
      readyToReconnect: filtered
        .filter((a) => a.declinedAt && daysSince(a.declinedAt) >= DECLINED_RESURFACE_AFTER_DAYS)
        .sort((a, b) => daysSince(b.declinedAt!) - daysSince(a.declinedAt!)),
      recentlyDeclined: filtered
        .filter((a) => a.declinedAt && daysSince(a.declinedAt) < DECLINED_RESURFACE_AFTER_DAYS)
        .sort((a, b) => a.declinedAt!.getTime() - b.declinedAt!.getTime()),
    };
  }, [filtered]);

  function card(agent: Agent) {
    return (
      <AgentCard
        key={agent.id}
        agent={agent}
        listingCount={agent.phone ? counts[agent.phone] ?? 0 : 0}
        listings={agent.phone ? listingsByPhone[agent.phone] ?? [] : []}
      />
    );
  }

  const nothingFound = filtered.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {displayedAgent && (
        <AgentDetailDialog
          key={displayedAgent.id}
          agent={displayedAgent}
          listings={displayedAgent.phone ? listingsByPhone[displayedAgent.phone] ?? [] : []}
          open={!!linkedAgent}
          onOpenChange={handleLinkedDialogOpenChange}
        />
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, or email…"
          className="pl-9"
        />
      </div>

      {nothingFound ? (
        <p className="text-muted-foreground/70 text-sm">No agents match &ldquo;{search}&rdquo;.</p>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            {RELATIONSHIP_ORDER.every((status) => byStatus[status].length === 0) ? (
              <p className="text-muted-foreground/70 text-sm">No active agents right now.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {RELATIONSHIP_ORDER.map(
                  (status) =>
                    byStatus[status].length > 0 && (
                      <div key={status}>
                        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                          {RELATIONSHIP_LABELS[status]} ({byStatus[status].length})
                        </h2>
                        <div className="flex flex-col gap-4">{byStatus[status].map(card)}</div>
                      </div>
                    )
                )}
              </div>
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
    </div>
  );
}
