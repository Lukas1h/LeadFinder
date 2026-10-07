"use client";

import { useState, useTransition } from "react";
import { HeartHandshake } from "lucide-react";
import type { Agent } from "@/db/schema";
import { dismissFollowUpAgent } from "@/app/agents/actions";
import { AgentCard } from "@/app/agents/AgentCard";

const GROUPS = [
  { label: "Past clients", match: (a: Agent) => a.relationshipStatus === "regular" || a.relationshipStatus === "worked_once" },
  { label: "Interested", match: (a: Agent) => a.relationshipStatus === "interested" },
  { label: "Warm", match: (a: Agent) => a.relationshipStatus === "warm" },
];

export function FollowUpList({
  agents,
  counts,
  dates,
}: {
  agents: Agent[];
  counts: Record<string, number>;
  dates: Record<string, { listedAt: Date | null; foundAt: Date }[]>;
}) {
  const [, startTransition] = useTransition();
  // Hidden right away on snooze, rather than waiting for the refresh.
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());

  const dismiss = (id: string) => {
    setSnoozed((prev) => new Set(prev).add(id));
    startTransition(() => dismissFollowUpAgent(id));
  };

  const visible = agents.filter((a) => !snoozed.has(a.id));

  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
        <HeartHandshake className="size-8" />
        <p>Everyone you know has heard from you in the last 4 weeks.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {GROUPS.map(({ label, match }) => {
        const group = visible.filter(match);
        if (group.length === 0) return null;
        return (
          <section key={label}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {label} ({group.length})
            </h2>
            <div className="flex flex-col gap-4">
              {group.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  listingCount={counts[agent.id] ?? 0}
                  listingDates={dates[agent.id] ?? []}
                  followUpDismiss={dismiss}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
