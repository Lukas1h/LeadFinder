"use client";

import { useState, useTransition, type ReactNode } from "react";
import { HeartHandshake } from "lucide-react";
import { dismissFollowUpAgent } from "@/app/agents/actions";
import { AgentCard } from "@/app/agents/AgentCard";
import { ListingRow } from "@/app/ListingRow";
import type { FollowUpEntry, JustListedEntry, NewsEntry } from "./data";
import { FOLLOW_UP_GROUPS } from "./groups";

export function FollowUpList({
  news,
  justListed,
  agents,
  counts,
  dates,
}: {
  news: NewsEntry[];
  justListed: JustListedEntry[];
  agents: FollowUpEntry[];
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

  const congrats = news.filter((e) => !snoozed.has(e.agent.id));
  const listed = justListed.filter((e) => !snoozed.has(e.agent.id));
  const quiet = agents.filter((e) => !snoozed.has(e.agent.id));

  if (congrats.length === 0 && listed.length === 0 && quiet.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
        <HeartHandshake className="size-8" />
        <p>Everyone you know has heard from you recently.</p>
      </div>
    );
  }

  const card = (e: FollowUpEntry, extra?: ReactNode) => (
    <AgentCard
      key={e.agent.id}
      agent={e.agent}
      listingCount={counts[e.agent.id] ?? 0}
      listingDates={dates[e.agent.id] ?? []}
      followUpDismiss={dismiss}
      lastReplyAt={e.lastReplyAt}
    >
      {extra}
    </AgentCard>
  );

  return (
    <div className="flex flex-col gap-8">
      {congrats.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Under contract or sold ({congrats.length})
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            A listing of theirs just went under contract or closed, and they haven&rsquo;t heard from you since.
            Congratulate them.
          </p>
          <div className="flex flex-col gap-4">
            {congrats.map((e) =>
              card(
                e,
                <>
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{e.label}</p>
                  <ListingRow listing={e.listing} />
                </>
              )
            )}
          </div>
        </section>
      )}
      {listed.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Just listed ({listed.length})
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            A client or interested agent put up a new listing and hasn&rsquo;t heard from you since.
          </p>
          <div className="flex flex-col gap-4">
            {listed.map((e) => card(e, <ListingRow listing={e.listing} />))}
          </div>
        </section>
      )}
      {FOLLOW_UP_GROUPS.map(({ label, match }) => {
        const group = quiet.filter((e) => match(e.agent));
        if (group.length === 0) return null;
        return (
          <section key={label}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {label} ({group.length})
            </h2>
            <div className="flex flex-col gap-4">{group.map((e) => card(e))}</div>
          </section>
        );
      })}
    </div>
  );
}
