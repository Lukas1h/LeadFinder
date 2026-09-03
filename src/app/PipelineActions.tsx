"use client";

import { useTransition } from "react";
import { MessageCircle, CheckCircle2, RotateCcw } from "lucide-react";
import { updateListingStatus, recordFollowUp } from "./actions";
import { firstName, smsUrl, initialOutreachMessage, followUpMessage } from "@/lib/sms";
import type { LeadStatus } from "@/db/schema";
import { Button } from "@/components/ui/button";

export function PipelineActions({
  listingId,
  status,
  address,
  agentName,
  agentPhone,
}: {
  listingId: string;
  status: LeadStatus;
  address: string | null;
  agentName: string | null;
  agentPhone: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  const goTo = (next: LeadStatus) => startTransition(() => updateListingStatus(listingId, next));

  const handleInitialText = () => {
    if (!agentPhone) return;
    const url = smsUrl(agentPhone, initialOutreachMessage(agentName, address));
    if (url) window.location.href = url;
    goTo("contacted");
  };

  const handleFollowUpText = () => {
    if (!agentPhone) return;
    const url = smsUrl(agentPhone, followUpMessage(agentName, address));
    if (url) window.location.href = url;
    startTransition(() => recordFollowUp(listingId));
  };

  const notInterested = (
    <Button variant="ghost" className="text-muted-foreground" onClick={() => goTo("declined")} disabled={isPending}>
      Not interested
    </Button>
  );

  if (status === "saved") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {agentPhone && (
          <Button onClick={handleInitialText} disabled={isPending}>
            <MessageCircle />
            Text {firstName(agentName) ?? "agent"}
          </Button>
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
          <Button variant="outline" onClick={handleFollowUpText} disabled={isPending}>
            <MessageCircle />
            Follow up
          </Button>
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
