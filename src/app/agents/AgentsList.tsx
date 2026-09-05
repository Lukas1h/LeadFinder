"use client";

import { useMemo, useState } from "react";
import { Search, RotateCcw, ChevronRight } from "lucide-react";
import type { Agent, Listing } from "@/db/schema";
import { daysSince } from "@/lib/format";
import { AgentCard } from "./AgentCard";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

const DECLINED_RESURFACE_AFTER_DAYS = 30;

// Relationship statuses that mean "an actual working relationship exists"
// — these get pinned above everyone else regardless of recency.
const PINNED_STATUSES = new Set(["worked_once", "regular"]);

function byRecency(a: Agent, b: Agent) {
  const aTime = a.lastContactedAt?.getTime() ?? 0;
  const bTime = b.lastContactedAt?.getTime() ?? 0;
  if (aTime !== bTime) return bTime - aTime;
  return (a.name ?? a.phone).localeCompare(b.name ?? b.phone);
}

function matchesSearch(agent: Agent, query: string): boolean {
  if (!query) return true;
  if (agent.name?.toLowerCase().includes(query)) return true;
  if (agent.phone.toLowerCase().includes(query)) return true;
  const digits = query.replace(/\D/g, "");
  if (digits && agent.phone.replace(/\D/g, "").includes(digits)) return true;
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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return agents.filter((a) => matchesSearch(a, query));
  }, [agents, search]);

  const { pinned, active, readyToReconnect, recentlyDeclined } = useMemo(() => {
    const notDeclined = filtered.filter((a) => !a.declinedAt);
    return {
      pinned: notDeclined.filter((a) => PINNED_STATUSES.has(a.relationshipStatus)).sort(byRecency),
      active: notDeclined.filter((a) => !PINNED_STATUSES.has(a.relationshipStatus)).sort(byRecency),
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
        listingCount={counts[agent.phone] ?? 0}
        listings={listingsByPhone[agent.phone] ?? []}
      />
    );
  }

  const nothingFound = filtered.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone…"
          className="pl-9"
        />
      </div>

      {nothingFound ? (
        <p className="text-muted-foreground/70 text-sm">No agents match &ldquo;{search}&rdquo;.</p>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            {pinned.length === 0 && active.length === 0 ? (
              <p className="text-muted-foreground/70 text-sm">No active agents right now.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {pinned.length > 0 && (
                  <>
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Working with
                    </h2>
                    {pinned.map(card)}
                    {active.length > 0 && <Separator className="my-1" />}
                  </>
                )}
                {active.map(card)}
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
