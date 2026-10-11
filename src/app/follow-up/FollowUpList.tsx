"use client";

import { useState, useTransition } from "react";
import { HeartHandshake } from "lucide-react";
import { dismissFollowUpAgent } from "@/app/agents/actions";
import { AgentCard } from "@/app/agents/AgentCard";
import { ListingRow } from "@/app/ListingRow";
import type { FollowUpItem } from "./data";

export function FollowUpList({
  today,
  later,
  doneToday,
  dailyTarget,
  counts,
  dates,
}: {
  today: FollowUpItem[];
  later: FollowUpItem[];
  doneToday: number;
  dailyTarget: number;
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

  const now = today.filter((e) => !snoozed.has(e.agent.id));
  const next = later.filter((e) => !snoozed.has(e.agent.id));

  if (now.length === 0 && next.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
        <HeartHandshake className="size-8" />
        <p>Everyone you know has heard from you recently.</p>
      </div>
    );
  }

  const card = (e: FollowUpItem) => (
    <AgentCard
      key={e.agent.id}
      agent={e.agent}
      listingCount={counts[e.agent.id] ?? 0}
      listingDates={dates[e.agent.id] ?? []}
      followUpDismiss={dismiss}
      lastReplyAt={e.lastReplyAt}
    >
      {/* The reason leads: it's what the text will be about. A plain "quiet" is the absence of one, so it's muted. */}
      <p
        className={
          e.reason === "quiet"
            ? "text-sm text-muted-foreground"
            : "text-sm font-medium text-emerald-700 dark:text-emerald-400"
        }
      >
        {e.label}
      </p>
      {e.listing ? (
        <ListingRow listing={e.listing} />
      ) : (
        e.address && <p className="text-sm text-foreground px-2">{[e.address, e.city].filter(Boolean).join(", ")}</p>
      )}
    </AgentCard>
  );

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Today ({Math.min(doneToday, dailyTarget)} of {dailyTarget} done)
        </h2>
        {now.length > 0 ? (
          <div className="flex flex-col gap-4 mt-3">{now.map(card)}</div>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">
            {doneToday >= dailyTarget ? "That\u2019s today\u2019s five. The rest will keep." : "Nobody else is due."}
          </p>
        )}
      </section>
      {next.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Later ({next.length})
          </h2>
          <div className="flex flex-col gap-4">{next.map(card)}</div>
        </section>
      )}
    </div>
  );
}
