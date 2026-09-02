"use client";

import { useTransition } from "react";
import { updateListingStatus } from "./actions";

function firstName(fullName: string | null): string | null {
  if (!fullName) return null;
  return fullName.trim().split(/\s+/)[0] || null;
}

function smsUrl(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, "");
  let target: string;
  if (digits.length === 10) target = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) target = `+${digits}`;
  else return null;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const separator = isIOS ? "&" : "?";
  return `sms:${target}${separator}body=${encodeURIComponent(message)}`;
}

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
    const name = firstName(agentName);
    const message = `Hi${name ? ` ${name}` : ""}, I'm a local real estate photographer and saw you just listed ${
      address ?? "your property"
    }. Let me know if you're looking for photos!`;
    const url = smsUrl(agentPhone, message);
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
        <button
          type="button"
          onClick={handleText}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 bg-blue-600 text-white font-medium text-sm px-4 py-2 rounded-lg shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Text {firstName(agentName) ?? "agent"}
        </button>
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 border border-gray-300 text-gray-700 font-medium text-sm px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
        Save
      </button>
      <button
        type="button"
        onClick={handleNotInterested}
        disabled={isPending}
        className="text-gray-400 font-medium text-sm px-2 py-2 hover:text-gray-600 disabled:opacity-50 transition-colors"
      >
        Not interested
      </button>
    </div>
  );
}
