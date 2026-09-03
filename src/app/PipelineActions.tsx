"use client";

import { useTransition } from "react";
import { MessageCircle, CheckCircle2, RotateCcw } from "lucide-react";
import { updateListingStatus } from "./actions";
import { SendMessageDialog } from "./SendMessageDialog";
import { firstName } from "@/lib/sms";
import type { LeadStatus } from "@/db/schema";
import { Button } from "@/components/ui/button";

export function PipelineActions({
  listingId,
  status,
  agentName,
  agentPhone,
}: {
  listingId: string;
  status: LeadStatus;
  agentName: string | null;
  agentPhone: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  const goTo = (next: LeadStatus) => startTransition(() => updateListingStatus(listingId, next));

  const notInterested = (
    <Button variant="ghost" className="text-muted-foreground" onClick={() => goTo("declined")} disabled={isPending}>
      Not interested
    </Button>
  );

  if (status === "saved") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {agentPhone && (
          <SendMessageDialog
            listingId={listingId}
            type="initial_outreach"
            agentPhone={agentPhone}
            trigger={
              <Button disabled={isPending}>
                <MessageCircle />
                Text {firstName(agentName) ?? "agent"}
              </Button>
            }
          />
        )}
        {notInterested}
      </div>
    );
  }

  if (status === "contacted") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={() => goTo("replied")} disabled={isPending}>
          <CheckCircle2 />
          Mark replied
        </Button>
        {agentPhone && (
          <SendMessageDialog
            listingId={listingId}
            type="follow_up"
            agentPhone={agentPhone}
            trigger={
              <Button variant="outline" disabled={isPending}>
                <MessageCircle />
                Follow up
              </Button>
            }
          />
        )}
        {notInterested}
      </div>
    );
  }

  if (status === "replied") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={() => goTo("booked")} disabled={isPending}>
          <CheckCircle2 />
          Mark booked
        </Button>
        {notInterested}
      </div>
    );
  }

  // booked / declined — closed states, just a correction valve.
  return (
    <Button variant="ghost" className="text-muted-foreground" onClick={() => goTo("new")} disabled={isPending}>
      <RotateCcw />
      Reopen
    </Button>
  );
}
