"use client";

import { useTransition } from "react";
import { MessageCircle, Bookmark, Mail } from "lucide-react";
import { updateListingStatus } from "./actions";
import { SendMessageDialog } from "./SendMessageDialog";
import { SendEmailDialog } from "./SendEmailDialog";
import { firstName } from "@/lib/sms";
import { Button } from "@/components/ui/button";

export function LeadActions({
  listingId,
  agentName,
  agentPhone,
  agentEmail,
  address,
}: {
  listingId: string;
  agentName: string | null;
  agentPhone: string | null;
  agentEmail?: string | null;
  address?: string | null;
}) {
  const [isPending, startTransition] = useTransition();

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
      <SendMessageDialog
        listingId={listingId}
        type="initial_outreach"
        agentPhone={agentPhone}
        trigger={
          <Button disabled={isPending}>
            <MessageCircle />
            Contact {firstName(agentName) ?? "agent"}
          </Button>
        }
      />

      <SendEmailDialog
        listingId={listingId}
        type="initial_outreach"
        agentEmail={agentEmail ?? null}
        agentName={agentName}
        address={address ?? null}
        trigger={
          <Button variant="outline" size="icon" disabled={isPending} aria-label={`Email ${firstName(agentName) ?? "agent"}`}>
            <Mail />
          </Button>
        }
      />

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
