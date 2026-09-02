"use client";

import { useTransition } from "react";
import { updateListingStatus, recordFollowUp } from "./actions";
import { firstName, smsUrl, initialOutreachMessage, followUpMessage } from "@/lib/sms";
import type { LeadStatus } from "@/db/schema";

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

  const primaryBtn =
    "inline-flex items-center gap-1.5 bg-blue-600 text-white font-medium text-sm px-4 py-2 rounded-lg shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors";
  const secondaryBtn =
    "inline-flex items-center gap-1.5 border border-gray-300 text-gray-700 font-medium text-sm px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors";
  const ghostBtn =
    "text-gray-400 font-medium text-sm px-2 py-2 hover:text-gray-600 disabled:opacity-50 transition-colors";

  if (status === "saved") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {agentPhone && (
          <button type="button" onClick={handleInitialText} disabled={isPending} className={primaryBtn}>
            Text {firstName(agentName) ?? "agent"}
          </button>
        )}
        <button type="button" onClick={() => goTo("declined")} disabled={isPending} className={ghostBtn}>
          Not interested
        </button>
      </div>
    );
  }

  if (status === "contacted") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => goTo("replied")} disabled={isPending} className={primaryBtn}>
          Mark replied
        </button>
        {agentPhone && (
          <button type="button" onClick={handleFollowUpText} disabled={isPending} className={secondaryBtn}>
            Follow up
          </button>
        )}
        <button type="button" onClick={() => goTo("declined")} disabled={isPending} className={ghostBtn}>
          Not interested
        </button>
      </div>
    );
  }

  if (status === "replied") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => goTo("booked")} disabled={isPending} className={primaryBtn}>
          Mark booked
        </button>
        <button type="button" onClick={() => goTo("declined")} disabled={isPending} className={ghostBtn}>
          Not interested
        </button>
      </div>
    );
  }

  // booked / declined — closed states, just a correction valve.
  return (
    <button type="button" onClick={() => goTo("new")} disabled={isPending} className={ghostBtn}>
      Reopen
    </button>
  );
}
