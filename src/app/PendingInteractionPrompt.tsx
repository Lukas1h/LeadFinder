"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Phone } from "lucide-react";
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
  confirmPendingTexts,
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

/**
 * Settles calls and texts once you're back in the app.
 *
 * Tapping Call opens the dialer and tapping Send opens Messages — in both cases
 * the app loses control and can't observe the result, so it records the attempt
 * as unresolved rather than asserting an outcome. This is the other half,
 * catching you on the way back:
 *
 * - A text is assumed sent (it nearly always is) and says so in a toast with an
 *   Undo. Undo is the old "I didn't send it": it deletes the optimistically
 *   recorded send and puts the listing, agent and queue back how they were,
 *   which keeps abandoned drafts out of the A/B numbers.
 * - A call asks how it went, since there's no safe default.
 *
 * Mounted app-wide (see AppChrome) since the return trip can land on any page.
 */
export function PendingInteractionPrompt() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    // Texts first, so the calls fetched next are all that's still pending.
    confirmPendingTexts()
      .then((texts) => {
        for (const text of texts) {
          toast.success(text.agentName ? `Message sent to ${text.agentName}!` : "Message sent!", {
            // Longer than the default: you've just switched back from Messages.
            duration: 8000,
            action: { label: "Undo", onClick: () => resolvePendingInteraction(text.id, "not_sent") },
          });
        }
        return getPendingInteractions();
      })
      .then((pending) => setQueue(pending.filter((p) => p.channel === "call")))
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
            <Phone className="size-4" />
            How did your call with {who} go?
          </DialogTitle>
          <DialogDescription>
            {current.listingAddress ? `About ${current.listingAddress}.` : "Logging this keeps your contact history accurate."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {CALL_OPTIONS.map((option) => (
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
