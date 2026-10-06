"use client";

import { useState } from "react";
import { Mail, MessageCircle, History } from "lucide-react";
import type { RecentSend } from "@/lib/messageStats";
import { formatPhone } from "@/lib/format";
import { MessageDetailDialog } from "./MessageDetailDialog";
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
 * not scoped to one agent; tapping a row opens the message's detail card,
 * where a reply is handled (see MessageDetailDialog). */
export function MessageHistoryCard({ sends }: { sends: RecentSend[] }) {
  const [sendId, setSendId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (sends.length === 0) return null;

  return (
    <Card className="p-3 gap-2">
      <div className="flex items-center gap-1.5 px-1">
        <History className="size-4 text-muted-foreground" />
        <h2 className="font-semibold text-foreground text-sm">Message history</h2>
        <span className="text-xs text-muted-foreground">· last {sends.length}</span>
      </div>

      <div className="flex flex-col divide-y divide-border/70 max-h-[32rem] overflow-y-auto -mx-1">
        {sends.map((s) => {
          const badge = s.result !== "pending" ? RESULT_LABELS[s.result] : s.respondedAt ? "Replied" : null;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSendId(s.id);
                setOpen(true);
              }}
              className="flex items-center gap-3 py-3.5 px-1.5 w-full text-left rounded-md hover:bg-muted/50 cursor-pointer"
            >
              {s.channel === "email" ? (
                <Mail className="size-5 shrink-0 text-muted-foreground" />
              ) : (
                <MessageCircle className="size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-foreground truncate">
                  {s.agentName ?? formatPhone(s.agentPhone) ?? s.agentEmail ?? "Unknown recipient"}
                </p>
                {s.listingAddress && <p className="text-sm text-foreground/80 truncate">{s.listingAddress}</p>}
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

      <MessageDetailDialog sendId={sendId} open={open} onOpenChange={setOpen} />
    </Card>
  );
}
