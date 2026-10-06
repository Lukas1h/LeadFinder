"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste, Mail, MessageCircle, ThumbsDown, Clock } from "lucide-react";
import { getSendDetail, markSendReply, sendSamplesForSend, type SendDetail } from "./replyActions";
import { AgentRow } from "@/app/AgentRow";
import { ListingRow } from "@/app/ListingRow";
import { smsUrl, firstName } from "@/lib/sms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Same loose match as FindEmailButton: pulls the address out of whatever was
// copied, e.g. a whole "sure! jane@brokerage.com" reply.
const EMAIL_IN_TEXT = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/i;

function formatWhen(date: Date): string {
  return new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Opened from a Message history row: the agent, the listing, what was sent,
 * and the reply handled in one tap — Send samples (the template's follow-up
 * email; asks for the address first when none is on file), Keep in touch,
 * Declined, or Text back.
 */
export function MessageDetailDialog({
  sendId,
  open,
  onOpenChange,
}: {
  sendId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<SendDetail | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!open || !sendId || loadedId === sendId) return;
    let cancelled = false;
    getSendDetail(sendId).then((d) => {
      if (cancelled) return;
      setDetail(d);
      setLoadedId(sendId);
    });
    return () => {
      cancelled = true;
    };
  }, [open, sendId, loadedId]);

  const shown = detail && detail.id === sendId ? detail : null;
  const agent = shown?.agent ?? null;
  const name = firstName(agent?.name ?? null) ?? "them";

  const finish = (message: string) => {
    toast.success(message);
    setEmailOpen(false);
    setLoadedId(null);
    onOpenChange(false);
  };

  const sendSamples = async (address?: string) => {
    if (!shown) return;
    setBusy("samples");
    const result = await sendSamplesForSend(shown.id, address);
    setBusy(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.note) toast(result.note);
    finish(`Samples sent to ${name}`);
  };

  const handleSamples = () => {
    if (agent?.email) void sendSamples();
    else {
      setEmail("");
      setEmailOpen(true);
    }
  };

  const paste = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast.error("Couldn't read the clipboard. Paste it into the box instead");
      return;
    }
    const found = text.match(EMAIL_IN_TEXT)?.[0];
    if (!found) {
      toast.error("There's no email on the clipboard");
      return;
    }
    setEmail(found);
  };

  const mark = async (kind: "keep_in_touch" | "declined") => {
    if (!shown) return;
    setBusy(kind);
    const result = await markSendReply(shown.id, kind);
    setBusy(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    finish(kind === "declined" ? `Marked ${name} as declined` : `${name} is warm, keep in touch`);
  };

  const status = shown
    ? shown.result === "declined"
      ? "Declined"
      : shown.result !== "pending"
        ? shown.result[0].toUpperCase() + shown.result.slice(1)
        : shown.respondedAt
          ? "Replied"
          : null
    : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {shown?.channel === "email" ? "Email" : "Text"} to {agent?.name ?? "agent"}
              {status && <Badge variant="secondary">{status}</Badge>}
            </DialogTitle>
            <DialogDescription>
              {shown ? `${shown.presetName} · ${formatWhen(shown.sentAt)}` : "Loading…"}
            </DialogDescription>
          </DialogHeader>

          {shown && (
            <div className="flex flex-col gap-3 min-w-0">
              {shown.followUpEmail && (
                <Button className="w-full" onClick={handleSamples} disabled={busy != null}>
                  <Mail />
                  {busy === "samples" ? "Sending…" : "Send samples"}
                </Button>
              )}
              <div className={`grid gap-2 ${agent?.phone ? "grid-cols-3" : "grid-cols-2"}`}>
                <Button variant="outline" size="sm" className="px-2" onClick={() => mark("keep_in_touch")} disabled={busy != null}>
                  <Clock />
                  Keep in touch
                </Button>
                <Button variant="outline" size="sm" onClick={() => mark("declined")} disabled={busy != null}>
                  <ThumbsDown />
                  Declined
                </Button>
                {agent?.phone && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={smsUrl(agent.phone, "")}>
                      <MessageCircle />
                      Text back
                    </a>
                  </Button>
                )}
              </div>
              {shown.followUpEmail && (
                <p className="text-xs text-muted-foreground -mt-1">
                  Send samples emails &ldquo;{shown.followUpEmail.name}&rdquo;
                  {agent?.email ? ` to ${agent.email}` : ", you'll paste their email"}. Both it and Keep in touch mark them warm.
                </p>
              )}

              <div className="flex flex-col -mx-2">
                {agent && (
                  <AgentRow name={agent.name} phone={agent.phone} agentId={agent.id} subtitle={agent.email} />
                )}
                {shown.listing && <ListingRow listing={shown.listing} />}
              </div>

              <p className="rounded-md bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap break-words">{shown.text}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{agent?.name ?? "Their"} email</DialogTitle>
            <DialogDescription>Copy it from their reply, then paste it here. It&rsquo;s saved to their profile.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void sendSamples(email);
            }}
          >
            <div className="flex gap-2">
              <Input
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="Their email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Button type="button" variant="outline" onClick={paste} disabled={busy != null}>
                <ClipboardPaste />
                Paste
              </Button>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!email.trim() || busy != null}>
                <Mail />
                {busy === "samples" ? "Sending…" : "Send samples"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
