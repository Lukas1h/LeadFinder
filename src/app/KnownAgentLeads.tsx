"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Groups on the "From agents you know" section, in display order. Clients are
// worked_once + regular: anyone who has actually paid for a shoot.
export type KnownAgentGroup = "clients" | "interested" | "warm";

const GROUP_LABELS: Record<KnownAgentGroup, string> = {
  clients: "Clients",
  interested: "Interested",
  warm: "Warm",
};

/**
 * The cards are rendered on the server (they're the same LeadCard the other
 * sections use) and handed in already sorted; this only filters them by the
 * agent's relationship.
 */
export function KnownAgentLeads({ items }: { items: { group: KnownAgentGroup; card: ReactNode }[] }) {
  const [filter, setFilter] = useState<KnownAgentGroup | "all">("all");
  const groups = (Object.keys(GROUP_LABELS) as KnownAgentGroup[]).filter((g) => items.some((i) => i.group === g));
  const shown = filter === "all" ? items : items.filter((i) => i.group === filter);

  return (
    <div className="flex flex-col gap-4 mt-3">
      {groups.length > 1 && (
        <Tabs value={filter} onValueChange={(v) => setFilter(v as KnownAgentGroup | "all")}>
          <TabsList>
            <TabsTrigger value="all">All {items.length}</TabsTrigger>
            {groups.map((g) => (
              <TabsTrigger key={g} value={g}>
                {GROUP_LABELS[g]} {items.filter((i) => i.group === g).length}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {shown.map((i) => i.card)}
    </div>
  );
}
