"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Phone, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getPendingInteractions,
  resolvePendingInteraction,
  dismissPendingInteraction,
} from "./agents/interactionActions";
import type { InteractionChannel, InteractionOutcome } from "@/db/schema";

interface Pending {
  id: string;
  channel: InteractionChannel;
  agentName: string | null;
  listingAddress: string | null;
  startedAt: Date;
}

const CALL_OPTIONS: { label: string; outcome: InteractionOutcome }[] = [
  { label: "They answered", outcome: "answered" },
  { label: "No answer", outcome: "no_answer" },
  { label: "Left a voicemail", outcome: "voicemail" },
];

const TEXT_OPTIONS: { label: string; outcome: InteractionOutcome }[] = [
  { label: "Yes, I sent it", outcome: "sent" },
  { label: "No, I didn't send it", outcome: "not_sent" },
];

/**
 * Asks how a call or text actually went, once you're back in the app.
 *
 * Tapping Call opens the dialer and tapping Send opens Messages — in both cases
 * the app loses control and can't observe the result, so it records the attempt
 * as unresolved rather than asserting an outcome. This is the other half:
 * catching you on the way back to fill in what really happened. Answering "I
 * didn't send it" also deletes the optimistically-recorded send, which is what
 * keeps abandoned drafts out of the A/B numbers.
 *
 * Mounted app-wide (see AppChrome) since the return trip can land on any page.
 */
export function PendingInteractionPrompt() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    getPendingInteractions()
      .then(setQueue)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    // visibilitychange is the signal that matters: leaving for the dialer or
    // Messages hides this document, and coming back shows it again. A plain
    // mount-time check alone would miss it, since a PWA returning from another
    // app doesn't remount.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  const current = queue[0];
  if (!current) return null;

  const options = current.channel === "call" ? CALL_OPTIONS : TEXT_OPTIONS;
  const who = current.agentName ?? "them";

  const answer = (outcome: InteractionOutcome) => {
    startTransition(async () => {
      await resolvePendingInteraction(current.id, outcome);
      setQueue((q) => q.slice(1));
    });
  };

  const skip = () => {
    startTransition(async () => {
      await dismissPendingInteraction(current.id);
      setQueue((q) => q.slice(1));
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && skip()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {current.channel === "call" ? <Phone className="size-4" /> : <MessageCircle className="size-4" />}
            {current.channel === "call" ? `How did your call with ${who} go?` : `Did your text to ${who} send?`}
          </DialogTitle>
          <DialogDescription>
            {current.listingAddress ? `About ${current.listingAddress}.` : "Logging this keeps your contact history accurate."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {options.map((option) => (
            <Button
              key={option.outcome}
              variant="outline"
              className="justify-start"
              disabled={isPending}
              onClick={() => answer(option.outcome)}
            >
              {option.label}
            </Button>
          ))}
          <Button variant="ghost" className="text-muted-foreground" disabled={isPending} onClick={skip}>
            Skip
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
