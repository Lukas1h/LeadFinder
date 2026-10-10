"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste, Mail, MessageCircle, Paperclip, ThumbsDown, Clock } from "lucide-react";
import {
  getSendDetail,
  markSendReply,
  recordQuickActionText,
  sendQuickActionEmail,
  type QuickAction,
  type SendDetail,
} from "./replyActions";
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
 * and the reply handled in one tap — the template's quick actions (an email
 * asks for the address first when none is on file; a text opens Messages),
 * Keep in touch, Declined, or Text back.
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
  // The email quick action waiting on an address.
  const [emailFor, setEmailFor] = useState<QuickAction | null>(null);
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
    setEmailFor(null);
    setLoadedId(null);
    onOpenChange(false);
  };

  const sendEmailAction = async (action: QuickAction, address?: string) => {
    if (!shown) return;
    setBusy(action.presetId);
    const result = await sendQuickActionEmail(shown.id, action.presetId, address);
    setBusy(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.note) toast(result.note);
    finish(`${action.name} sent to ${name}`);
  };

  const runAction = async (action: QuickAction) => {
    if (!shown) return;
    if (action.channel === "email") {
      if (agent?.email) void sendEmailAction(action);
      else {
        setEmail("");
        setEmailFor(action);
      }
      return;
    }
    // A text: recorded as it's handed to Messages, like every text from the
    // web, and confirmed by the usual "did it go?" prompt.
    if (!agent?.phone) return;
    setBusy(action.presetId);
    const result = await recordQuickActionText(shown.id, action.presetId, action.variantId, false);
    setBusy(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    window.location.href = smsUrl(agent.phone, action.text);
    finish(`${action.name} opened in Messages`);
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
              {shown.quickActions.map((action, i) => {
                // An sms: link can't carry a file, so these only go from the phone.
                const phoneOnly = action.channel === "sms" && action.attachments.length > 0;
                return (
                  <Button
                    key={action.presetId}
                    variant={i === 0 ? "default" : "outline"}
                    className="w-full"
                    onClick={() => runAction(action)}
                    disabled={busy != null || phoneOnly || (action.channel === "sms" && !agent?.phone)}
                    title={phoneOnly ? "Has attachments: send it from the iPhone app" : undefined}
                  >
                    {action.channel === "email" ? <Mail /> : phoneOnly ? <Paperclip /> : <MessageCircle />}
                    {busy === action.presetId ? "Sending…" : action.name}
                    {phoneOnly && <span className="text-xs font-normal opacity-70">iPhone only</span>}
                  </Button>
                );
              })}
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
              {shown.quickActions.some((q) => q.channel === "email") && (
                <p className="text-xs text-muted-foreground -mt-1">
                  {shown.quickActions.find((q) => q.channel === "email")!.name} is emailed
                  {agent?.email ? ` to ${agent.email}` : ", you'll paste their email"}. A quick action or Keep in touch
                  marks them warm.
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

      <Dialog open={emailFor != null} onOpenChange={(o) => !o && setEmailFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{agent?.name ?? "Their"} email</DialogTitle>
            <DialogDescription>Copy it from their reply, then paste it here. It&rsquo;s saved to their profile.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim() && emailFor) void sendEmailAction(emailFor, email);
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
                {busy != null ? "Sending…" : `Send ${emailFor?.name ?? "email"}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
