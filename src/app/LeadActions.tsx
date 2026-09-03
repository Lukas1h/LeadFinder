"use client";

import { useTransition } from "react";
import { MessageCircle, Bookmark } from "lucide-react";
import { updateListingStatus } from "./actions";
import { firstName, smsUrl, initialOutreachMessage } from "@/lib/sms";
import { Button } from "@/components/ui/button";

export function LeadActions({
  listingId,
  address,
  agentName,
  agentPhone,
}: {
  listingId: string;
  address: string | null;
  agentName: string | null;
  agentPhone: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  const handleText = () => {
    if (!agentPhone) return;
    const url = smsUrl(agentPhone, initialOutreachMessage(agentName, address));
    if (url) window.location.href = url;
    startTransition(() => {
      updateListingStatus(listingId, "contacted");
    });
  };

  const handleSave = () => {
    startTransition(() => {
      updateListingStatus(listingId, "saved");
    });
  };

  const handleNotInterested = () => {
    startTransition(() => {
      updateListingStatus(listingId, "declined");
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {agentPhone && (
        <Button onClick={handleText} disabled={isPending}>
          <MessageCircle />
          Text {firstName(agentName) ?? "agent"}
        </Button>
      )}
      <Button variant="outline" onClick={handleSave} disabled={isPending}>
        <Bookmark />
        Save
      </Button>
      <Button variant="ghost" className="text-muted-foreground" onClick={handleNotInterested} disabled={isPending}>
        Not interested
      </Button>
    </div>
  );
}
