"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, ChevronRight, Loader2 } from "lucide-react";
import type { Agent, AgentRelationshipStatus } from "@/db/schema";
import { AgentCard } from "./AgentCard";
import { RELATIONSHIP_LABELS } from "./relationshipLabels";
import { AgentDetailDialog } from "./AgentDetailDialog";
import { getAllColdAgents, searchAllAgents } from "./actions";
import { COLD_INITIAL_LIMIT } from "./constants";
import { Input } from "@/components/ui/input";

// Most-established relationship first — mirrors the natural progression
// (see bumpAgentRelationshipOnMilestone in src/app/actions.ts).
const RELATIONSHIP_ORDER: AgentRelationshipStatus[] = [
  "regular",
  "worked_once",
  "interested",
  "warm",
  "declined",
  "cold",
];

function byRecency(a: Agent, b: Agent) {
  const aTime = a.lastContactedAt?.getTime() ?? 0;
  const bTime = b.lastContactedAt?.getTime() ?? 0;
  if (aTime !== bTime) return bTime - aTime;
  return (a.name ?? a.phone ?? a.email ?? "").localeCompare(b.name ?? b.phone ?? b.email ?? "");
}

// "cold" agents have never been contacted, so byRecency's lastContactedAt
// always ties and falls back to alphabetical — useless for "show the
// recently added ones" (the whole point of the cap below), so this group
// sorts by when the row was created instead.
function byCreatedDesc(a: Agent, b: Agent) {
  return b.createdAt.getTime() - a.createdAt.getTime();
}

function isColdAndFresh(a: Agent): boolean {
  return a.relationshipStatus === "cold";
}

export function AgentsList({
  agents,
  counts,
  listingDatesByAgent,
  coldFreshTotal,
}: {
  agents: Agent[];
  counts: Record<string, number>;
  listingDatesByAgent: Record<string, { listedAt: Date | null; foundAt: Date }[]>;
  // True count of the cold-and-never-contacted bucket — the `agents` prop
  // only carries COLD_INITIAL_LIMIT of them, so the section header and
  // "View all" button need this separately to show the real number.
  coldFreshTotal: number;
}) {
  const [search, setSearch] = useState("");
  // null = no results known yet for the current query (still debouncing or
  // the request is in flight) — distinct from an empty array (a real "no
  // matches"), so the loading state can't flash stale results from a
  // previous query.
  const [searchResults, setSearchResults] = useState<Agent[] | null>(null);
  const [, startSearchTransition] = useTransition();

  const [coldFreshOverride, setColdFreshOverride] = useState<Agent[] | null>(null);
  const [isLoadingAllCold, startLoadAllColdTransition] = useTransition();

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

  // Debounced server-side search — the page deliberately doesn't load
  // every agent client-side anymore (see COLD_INITIAL_LIMIT above), so
  // search has to ask the DB instead of filtering an in-memory list.
  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setSearchResults(null);
      return;
    }
    setSearchResults(null);
    let cancelled = false;
    const timer = setTimeout(() => {
      startSearchTransition(async () => {
        const results = await searchAllAgents(query);
        if (!cancelled) setSearchResults(results);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  const handleViewAllCold = () => {
    startLoadAllColdTransition(async () => {
      const all = await getAllColdAgents();
      setColdFreshOverride(all);
    });
  };

  // Once "View all" has loaded the full cold bucket, it replaces (not
  // appends to) the initial capped slice already in `agents` — otherwise
  // the first COLD_INITIAL_LIMIT would render twice.
  const effectiveAgents = useMemo(() => {
    if (!coldFreshOverride) return agents;
    return [...agents.filter((a) => !isColdAndFresh(a)), ...coldFreshOverride];
  }, [agents, coldFreshOverride]);

  const { byStatus } = useMemo(() => {
    const groups: Record<AgentRelationshipStatus, Agent[]> = {
      cold: [],
      warm: [],
      interested: [],
      worked_once: [],
      regular: [],
      declined: [],
    };
    for (const a of effectiveAgents) groups[a.relationshipStatus].push(a);
    for (const status of RELATIONSHIP_ORDER) groups[status].sort(status === "cold" ? byCreatedDesc : byRecency);

    return {
      byStatus: groups,
    };
  }, [effectiveAgents]);

  function card(agent: Agent) {
    return (
      <AgentCard
        key={agent.id}
        agent={agent}
        listingCount={counts[agent.id] ?? 0}
        listingDates={listingDatesByAgent[agent.id] ?? []}
      />
    );
  }

  const isSearching = search.trim().length > 0;
  const coldDisplayTotal = coldFreshOverride ? coldFreshOverride.length : coldFreshTotal;

  return (
    <div className="flex flex-col gap-6">
      {displayedAgent && (
        <AgentDetailDialog
          key={displayedAgent.id}
          agent={displayedAgent}
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

      {isSearching ? (
        searchResults === null ? (
          <p className="text-muted-foreground/70 text-sm flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" />
            Searching…
          </p>
        ) : searchResults.length === 0 ? (
          <p className="text-muted-foreground/70 text-sm">No agents match &ldquo;{search}&rdquo;.</p>
        ) : (
          <div className="flex flex-col gap-4">{searchResults.map(card)}</div>
        )
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            {RELATIONSHIP_ORDER.every((status) => byStatus[status].length === 0) ? (
              <p className="text-muted-foreground/70 text-sm">No active agents right now.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {RELATIONSHIP_ORDER.map((status) => {
                  if (byStatus[status].length === 0) return null;

                  const isColdBucket = status === "cold";
                  const visible = byStatus[status];
                  const showViewAll = isColdBucket && !coldFreshOverride && coldFreshTotal > visible.length;

                  return (
                    <div key={status}>
                      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                        {RELATIONSHIP_LABELS[status]} ({isColdBucket ? coldDisplayTotal.toLocaleString() : visible.length})
                      </h2>
                      <div className="flex flex-col gap-4">{visible.map(card)}</div>
                      {showViewAll && (
                        <button
                          type="button"
                          onClick={handleViewAllCold}
                          disabled={isLoadingAllCold}
                          className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground text-center py-2 rounded-md border border-dashed hover:border-solid transition-colors disabled:opacity-60"
                        >
                          {isLoadingAllCold ? "Loading…" : `View all ${coldFreshTotal.toLocaleString()} agents`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

        </div>
      )}
    </div>
  );
}
