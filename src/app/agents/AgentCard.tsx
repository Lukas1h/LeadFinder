"use client";

import { useTransition } from "react";
import Link from "next/link";
import { RotateCcw, Phone, MessageCircle, Mail, StickyNote } from "lucide-react";
import type { Agent, AgentRelationshipStatus, Listing } from "@/db/schema";
import { updateAgentRelationshipStatus, reconnectAgent, markAgentDeclined } from "./actions";
import { AgentDetailDialog } from "./AgentDetailDialog";
import { formatDate, daysSince } from "@/lib/format";
import { telUrl, smsUrl } from "@/lib/sms";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const RELATIONSHIP_LABELS: Record<AgentRelationshipStatus, string> = {
  cold: "Cold",
  warm: "Warm",
  interested: "Interested",
  worked_once: "Worked once",
  regular: "Regular",
};

const RELATIONSHIP_OPTIONS = Object.entries(RELATIONSHIP_LABELS) as [AgentRelationshipStatus, string][];

export function AgentCard({
  agent,
  listingCount,
  listings,
}: {
  agent: Agent;
  listingCount: number;
  listings: Listing[];
}) {
  const [isPending, startTransition] = useTransition();

  const handleStatusChange = (status: AgentRelationshipStatus) => {
    startTransition(() => updateAgentRelationshipStatus(agent.id, status));
  };

  const handleReconnect = () => {
    startTransition(() => reconnectAgent(agent.id));
  };

  const handleMarkDeclined = () => {
    startTransition(() => markAgentDeclined(agent.id));
  };

  const callHref = telUrl(agent.phone);

  return (
    <Card className="flex-row items-start justify-between gap-4 p-4 flex-wrap">
      <div className="min-w-0">
        <AgentDetailDialog
          agent={agent}
          listings={listings}
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
        </div>

        {agent.declinedAt && (
          <Badge variant="secondary" className="mt-2">
            Declined {daysSince(agent.declinedAt)}d ago
          </Badge>
        )}

        {agent.notes && (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground mt-2 max-w-md">
            <StickyNote className="size-3.5 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{agent.notes}</span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
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

        {agent.declinedAt ? (
          <Button variant="outline" size="sm" onClick={handleReconnect} disabled={isPending}>
            <RotateCcw />
            Reconnect
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={handleMarkDeclined}
            disabled={isPending}
          >
            Mark declined
          </Button>
        )}
      </div>
    </Card>
  );
}
