"use client";

import { useTransition } from "react";
import { MessageCircle, CheckCircle2, FileText, RotateCcw } from "lucide-react";
import { updateListingStatus } from "./actions";
import { SendContactDialog } from "./SendContactDialog";
import { BookingForm } from "./booked/BookingForm";
import { firstName } from "@/lib/sms";
import type { LeadStatus } from "@/db/schema";
import { Button } from "@/components/ui/button";

export function PipelineActions({
  listingId,
  status,
  agentName,
  agentPhone,
  agentEmail,
  address,
  city,
}: {
  listingId: string;
  status: LeadStatus;
  agentName: string | null;
  agentPhone: string | null;
  agentEmail?: string | null;
  address?: string | null;
  city?: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  const goTo = (next: LeadStatus) => startTransition(() => updateListingStatus(listingId, next));

  // Two different dead ends that used to be one button. "I'm passing" is Lukas's
  // call about the property; "They said no" is the agent's answer and is the only
  // thing that marks the agent declined. Before the split, triaging a listing
  // flagged its agent as a rejection, which buried warm contacts.
  const passed = (
    <Button variant="ghost" className="text-muted-foreground" onClick={() => goTo("passed")} disabled={isPending}>
      I&apos;m passing
    </Button>
  );

  const declined = (
    <Button variant="ghost" className="text-muted-foreground" onClick={() => goTo("declined")} disabled={isPending}>
      They said no
    </Button>
  );

  if (status === "saved") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <SendContactDialog
          listingId={listingId}
          type="initial_outreach"
          agentPhone={agentPhone}
          agentEmail={agentEmail ?? null}
          agentName={agentName}
          address={address ?? null}
          city={city ?? null}
          trigger={
            <Button disabled={isPending}>
              <MessageCircle />
              Contact {firstName(agentName) ?? "agent"}
            </Button>
          }
        />
        {passed}
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
        <SendContactDialog
          listingId={listingId}
          type="follow_up"
          agentPhone={agentPhone}
          agentEmail={agentEmail ?? null}
          agentName={agentName}
          address={address ?? null}
          city={city ?? null}
          trigger={
            <Button variant="outline" disabled={isPending}>
              <MessageCircle />
              Follow up
            </Button>
          }
        />
        {declined}
        {passed}
      </div>
    );
  }

  if (status === "replied") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" onClick={() => goTo("quoted")} disabled={isPending}>
          <FileText />
          Mark quoted
        </Button>
        <BookingForm
          listingId={listingId}
          agentName={agentName}
          agentPhone={agentPhone}
          trigger={
            <Button disabled={isPending}>
              <CheckCircle2 />
              Mark booked
            </Button>
          }
        />
        {declined}
        {passed}
      </div>
    );
  }

  if (status === "quoted") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <BookingForm
          listingId={listingId}
          agentName={agentName}
          agentPhone={agentPhone}
          trigger={
            <Button disabled={isPending}>
              <CheckCircle2 />
              Mark booked
            </Button>
          }
        />
        {declined}
        {passed}
      </div>
    );
  }

  // booked / passed / declined — closed states, just a correction valve.
  return (
    <Button variant="ghost" className="text-muted-foreground" onClick={() => goTo("saved")} disabled={isPending}>
      <RotateCcw />
      Reopen
    </Button>
  );
}
