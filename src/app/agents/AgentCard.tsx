"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Phone, MessageCircle, Mail, StickyNote, BellOff } from "lucide-react";
import type { Agent, AgentRelationshipStatus } from "@/db/schema";
import { updateAgentRelationshipStatus } from "./actions";
import { resolveAvgDaysBetweenListings } from "./stats";
import { AgentDetailDialog } from "./AgentDetailDialog";
import { RELATIONSHIP_OPTIONS } from "./relationshipLabels";
import { formatDate } from "@/lib/format";
import { telUrl, smsUrl } from "@/lib/sms";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AgentCard({
  agent,
  listingCount,
  listingDates,
  followUpDismiss,
}: {
  agent: Agent;
  listingCount: number;
  // Just the dates the "~Nd between listings" stat needs. The dialog fetches
  // the agent's full listings itself when it opens.
  listingDates: { listedAt: Date | null; foundAt: Date }[];
  // When set, shows a "Not now" snooze button (the Follow up section's
  // dismiss — hides this agent from that list for another 28 days).
  followUpDismiss?: (agentId: string) => void;
}) {
  const [isPending, startTransition] = useTransition();

  const handleStatusChange = (status: AgentRelationshipStatus) => {
    startTransition(() => updateAgentRelationshipStatus(agent.id, status));
  };

  const callHref = telUrl(agent.phone);
  const avgDaysBetweenListings = resolveAvgDaysBetweenListings(agent, listingDates);

  return (
    <Card className="flex-row items-start justify-between gap-4 p-4 flex-wrap">
      <div className="min-w-0">
        <AgentDetailDialog
          agent={agent}
          trigger={
            <button type="button" className="font-semibold text-foreground hover:underline text-left">
              {agent.name ?? "Unknown name"}
            </button>
          }
        />
        <div className="flex flex-wrap items-baseline gap-x-2">
          {agent.phone && <p className="text-xs text-muted-foreground font-mono mt-0.5">{agent.phone}</p>}
          {agent.email && <p className="text-xs text-muted-foreground font-mono mt-0.5">{agent.email}</p>}
        </div>
        <div className="text-sm text-muted-foreground mt-1.5 flex flex-wrap gap-x-3">
          <span>
            {listingCount} listing{listingCount === 1 ? "" : "s"}
          </span>
          {agent.lastContactedAt && <span>Last contacted {formatDate(agent.lastContactedAt)}</span>}
          {avgDaysBetweenListings != null && <span>~{avgDaysBetweenListings}d between listings</span>}
        </div>


        {agent.notes && (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground mt-2 max-w-md">
            <StickyNote className="size-3.5 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{agent.notes}</span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {followUpDismiss && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => followUpDismiss(agent.id)}
            disabled={isPending}
            title="Hide from Follow up for another 28 days"
            aria-label={`Dismiss ${agent.name ?? agent.phone} from follow up for 28 days`}
          >
            <BellOff />
          </Button>
        )}
        {callHref && (
          <Button variant="outline" size="icon" asChild>
            <a href={callHref} aria-label={`Call ${agent.name ?? agent.phone}`}>
              <Phone />
            </a>
          </Button>
        )}
        {agent.phone && (
          <Button variant="outline" size="icon" asChild>
            <a href={smsUrl(agent.phone, "")} aria-label={`Text ${agent.name ?? agent.phone}`}>
              <MessageCircle />
            </a>
          </Button>
        )}
        {agent.email && (
          <Button variant="outline" size="icon" asChild>
            <Link href={`/messaging?agent=${agent.id}`} aria-label={`Email ${agent.name ?? agent.email}`}>
              <Mail />
            </Link>
          </Button>
        )}

        <Select value={agent.relationshipStatus} onValueChange={handleStatusChange} disabled={isPending}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RELATIONSHIP_OPTIONS.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}
