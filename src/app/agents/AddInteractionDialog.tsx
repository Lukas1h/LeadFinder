"use client";

import { useState, useTransition } from "react";
import { Phone, MessageCircle, Mail, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { logInteraction } from "./interactionActions";
import type { InteractionChannel, InteractionDirection, InteractionOutcome } from "@/db/schema";

/**
 * Narrows the interaction down one question at a time rather than offering
 * every combination as a flat list. The list version needed a row per
 * direction x channel x outcome, which is eleven near-identical lines to read
 * through for what is really three quick choices.
 *
 * The outcome step only exists for calls. A text or an email either happened or
 * it didn't — there's nothing to record about how it landed, since replies are
 * tracked as their own inbound interaction rather than as an outcome of the
 * outbound one.
 */
const DIRECTIONS: { value: InteractionDirection; label: string }[] = [
  { value: "outbound", label: "I did" },
  { value: "inbound", label: "They did" },
];

const CHANNELS: { value: InteractionChannel; label: string; icon: typeof Phone }[] = [
  { value: "call", label: "Call", icon: Phone },
  { value: "text", label: "Text", icon: MessageCircle },
  { value: "email", label: "Email", icon: Mail },
];

// Phrased from whichever side placed the call, since "no answer" and "declined"
// mean different things depending on who was holding the phone.
const CALL_OUTCOMES: Record<InteractionDirection, { value: InteractionOutcome; label: string }[]> = {
  outbound: [
    { value: "answered", label: "They answered" },
    { value: "no_answer", label: "No answer" },
    { value: "voicemail", label: "Left a voicemail" },
  ],
  inbound: [
    { value: "answered", label: "I answered" },
    { value: "no_answer", label: "I missed it" },
    { value: "voicemail", label: "They left a voicemail" },
  ],
};

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function StepRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="grid grid-flow-col auto-cols-fr gap-1.5">{children}</div>
    </div>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-sm transition-colors",
        selected
          ? "border-primary bg-primary/5 text-foreground font-medium"
          : "border-border text-muted-foreground hover:bg-muted/50"
      )}
    >
      {children}
    </button>
  );
}

export function AddInteractionDialog({
  agentId,
  listingId,
  onLogged,
}: {
  agentId: string;
  listingId?: string | null;
  onLogged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<InteractionDirection | null>(null);
  const [channel, setChannel] = useState<InteractionChannel | null>(null);
  const [outcome, setOutcome] = useState<InteractionOutcome | null>(null);
  const [note, setNote] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => toLocalInputValue(new Date()));
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setDirection(null);
    setChannel(null);
    setOutcome(null);
    setNote("");
    setOccurredAt(toLocalInputValue(new Date()));
  };

  const needsOutcome = channel === "call";
  const canSave = direction != null && channel != null && (!needsOutcome || outcome != null);

  const handleSave = () => {
    if (!canSave || !direction || !channel) return;
    startTransition(async () => {
      await logInteraction({
        agentId,
        listingId: listingId ?? null,
        channel,
        direction,
        outcome: needsOutcome ? outcome : null,
        note,
        occurredAt: new Date(occurredAt),
      });
      toast.success("Interaction logged");
      setOpen(false);
      reset();
      onLogged?.();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus />
          Add interaction
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log an interaction</DialogTitle>
          <DialogDescription>Anything that happened outside the app.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <StepRow label="Who reached out?">
            {DIRECTIONS.map((d) => (
              <Choice
                key={d.value}
                selected={direction === d.value}
                onClick={() => {
                  setDirection(d.value);
                  // The outcome labels are written from the caller's side, so a
                  // direction change invalidates whatever was picked.
                  setOutcome(null);
                }}
              >
                {d.label}
              </Choice>
            ))}
          </StepRow>

          {direction && (
            <StepRow label="How?">
              {CHANNELS.map((c) => {
                const Icon = c.icon;
                return (
                  <Choice
                    key={c.value}
                    selected={channel === c.value}
                    onClick={() => {
                      setChannel(c.value);
                      setOutcome(null);
                    }}
                  >
                    <Icon className="size-3.5" />
                    {c.label}
                  </Choice>
                );
              })}
            </StepRow>
          )}

          {direction && needsOutcome && (
            <StepRow label="What happened?">
              {CALL_OUTCOMES[direction].map((o) => (
                <Choice key={o.value} selected={outcome === o.value} onClick={() => setOutcome(o.value)}>
                  {o.label}
                </Choice>
              ))}
            </StepRow>
          )}
        </div>

        {channel && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="interaction-when" className="text-xs text-muted-foreground">
                When
              </Label>
              <Input
                id="interaction-when"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="interaction-note" className="text-xs text-muted-foreground">
                Note (optional)
              </Label>
              <Textarea
                id="interaction-note"
                rows={3}
                placeholder="What did you talk about?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </>
        )}

        <DialogFooter>
          <Button onClick={handleSave} disabled={!canSave || isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
