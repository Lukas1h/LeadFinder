import { Mail, MessageCircle, History } from "lucide-react";
import type { RecentSend } from "@/lib/messageStats";
import { formatDate, formatPhone } from "@/lib/format";
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

/** Recent-activity feed at the top of the messaging page — every SMS/email
 * send, newest first, across every preset and recipient. Same row shape as
 * AgentDetailDialog's per-agent "Contact history" (src/app/agents/
 * AgentDetailDialog.tsx), just not scoped to one agent. */
export function RecentSendsCard({ sends }: { sends: RecentSend[] }) {
  if (sends.length === 0) return null;

  return (
    <Card className="p-3 gap-2 mb-8">
      <div className="flex items-center gap-1.5 px-1">
        <History className="size-3.5 text-muted-foreground" />
        <h2 className="font-semibold text-foreground text-xs">Recently sent</h2>
      </div>

      <div className="flex flex-col divide-y divide-border/70 max-h-40 overflow-y-auto -mx-1">
        {sends.map((s) => (
          <div key={s.id} className="flex items-start gap-2 py-1.5 px-1">
            {s.channel === "email" ? (
              <Mail className="size-3 shrink-0 mt-0.5 text-muted-foreground" />
            ) : (
              <MessageCircle className="size-3 shrink-0 mt-0.5 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-foreground truncate">
                {s.agentName ?? formatPhone(s.agentPhone) ?? "Unknown recipient"}
                {s.listingAddress && <span className="text-muted-foreground"> · {s.listingAddress}</span>}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {s.presetName} · {TYPE_LABELS[s.type]} · {formatDate(s.sentAt)}
              </p>
            </div>
            {s.result !== "pending" && (
              <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">
                {RESULT_LABELS[s.result]}
              </Badge>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
