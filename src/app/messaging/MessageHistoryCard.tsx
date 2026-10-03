"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Mail, MessageCircle, History } from "lucide-react";
import type { Agent } from "@/db/schema";
import type { RecentSend } from "@/lib/messageStats";
import { formatPhone } from "@/lib/format";
import { getAgentById } from "@/app/agents/actions";
import { AgentDetailDialog } from "@/app/agents/AgentDetailDialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const RESULT_LABELS: Record<RecentSend["result"], string> = {
  pending: "Pending",
  quoted: "Quoted",
  booked: "Booked",
  declined: "Declined",
};

const TYPE_LABELS: Record<RecentSend["type"], string> = {
  initial_outreach: "Initial outreach",
  follow_up: "Follow-up",
};

function formatWhen(date: Date): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The last 100 SMS/email sends across every preset and recipient, newest
 * first, in a scrolling list. Same row shape as AgentDetailDialog's
 * per-agent "Contact history" (src/app/agents/AgentDetailDialog.tsx), just
 * not scoped to one agent; tapping a row opens that agent's detail dialog. */
export function MessageHistoryCard({ sends }: { sends: RecentSend[] }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [open, setOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  if (sends.length === 0) return null;

  const openAgent = async (send: RecentSend) => {
    if (!send.agentId) return;
    setLoadingId(send.id);
    const result = await getAgentById(send.agentId);
    setLoadingId(null);
    if (!result) {
      toast.error("That agent no longer exists");
      return;
    }
    setAgent(result);
    setOpen(true);
  };

  return (
    <Card className="p-3 gap-2">
      <div className="flex items-center gap-1.5 px-1">
        <History className="size-4 text-muted-foreground" />
        <h2 className="font-semibold text-foreground text-sm">Message history</h2>
        <span className="text-xs text-muted-foreground">· last {sends.length}</span>
      </div>

      <div className="flex flex-col divide-y divide-border/70 max-h-[28rem] overflow-y-auto -mx-1">
        {sends.map((s) => {
          const badge = s.result !== "pending" ? RESULT_LABELS[s.result] : s.respondedAt ? "Replied" : null;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => openAgent(s)}
              disabled={!s.agentId || loadingId === s.id}
              className="flex items-start gap-2.5 py-2.5 px-1 w-full text-left rounded-md hover:bg-muted/50 disabled:hover:bg-transparent disabled:opacity-60 enabled:cursor-pointer"
            >
              {s.channel === "email" ? (
                <Mail className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
              ) : (
                <MessageCircle className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground truncate">
                  {s.agentName ?? formatPhone(s.agentPhone) ?? s.agentEmail ?? "Unknown recipient"}
                  {s.listingAddress && <span className="text-muted-foreground"> · {s.listingAddress}</span>}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.presetName} · {TYPE_LABELS[s.type]} · {formatWhen(s.sentAt)}
                </p>
              </div>
              {badge && (
                <Badge variant="secondary" className="shrink-0">
                  {badge}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {agent && <AgentDetailDialog agent={agent} open={open} onOpenChange={setOpen} />}
    </Card>
  );
}
