"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, MessageCircle, Send, SkipForward, Trash2, Pencil, Undo2, Link2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { smsUrl } from "@/lib/sms";
import { isInSendWindow } from "@/lib/queue";
import {
  sendQueuedEmail,
  markQueuedTextOpened,
  setQueuedMessageStatus,
  deleteQueuedMessage,
  type QueueItem,
} from "./actions";
import { EditQueuedDialog } from "./EditQueuedDialog";

const DAY_MS = 24 * 60 * 60 * 1000;

function formatWhen(date: Date): string {
  return new Date(date).toLocaleString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relative(date: Date, now: number): string {
  const minutes = Math.round((new Date(date).getTime() - now) / 60_000);
  if (minutes < 60) return `in ${Math.max(minutes, 1)} min`;
  if (minutes < 24 * 60) return `in ${Math.round(minutes / 60)} hr`;
  return formatWhen(date);
}

export function QueueList({ items }: { items: QueueItem[] }) {
  // Re-evaluate what's due every 30s, so a message slides from Scheduled to
  // Due now without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const queued = items.filter((i) => i.status === "queued");
  const due = queued.filter((i) => !i.waitingOnId && new Date(i.dueAt).getTime() <= now);
  const scheduled = queued.filter((i) => !due.includes(i));
  const done = items
    .filter((i) => i.status !== "queued")
    .sort((a, b) => new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime());
  const outsideWindow = !isInSendWindow(new Date(now));

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {queued.length} queued message{queued.length === 1 ? "" : "s"} · sends 8 AM–9 PM
        </p>
      </header>

      <Tabs defaultValue="due">
        <TabsList className="mb-4">
          <TabsTrigger value="due">Due now ({due.length})</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled ({scheduled.length})</TabsTrigger>
          <TabsTrigger value="done">Done ({done.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="due" className="flex flex-col gap-3">
          {due.length === 0 && (
            <Empty>
              {outsideWindow && scheduled.length > 0
                ? "Outside sending hours — queued messages wait until 8 AM."
                : "Nothing due right now."}
            </Empty>
          )}
          {due.map((item) => (
            <QueueCard key={item.id} item={item} now={now} />
          ))}
        </TabsContent>

        <TabsContent value="scheduled" className="flex flex-col gap-3">
          {scheduled.length === 0 && <Empty>Nothing scheduled.</Empty>}
          {scheduled.map((item) => (
            <QueueCard key={item.id} item={item} now={now} />
          ))}
        </TabsContent>

        <TabsContent value="done" className="flex flex-col gap-3">
          {done.length === 0 && <Empty>Nothing sent or skipped in the last 2 days.</Empty>}
          {done.map((item) => (
            <QueueCard key={item.id} item={item} now={now} />
          ))}
        </TabsContent>
      </Tabs>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground/70 py-10 text-center">{children}</p>;
}

function QueueCard({ item, now }: { item: QueueItem; now: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const isQueued = item.status === "queued";
  const isEmail = item.channel === "email";
  const to = item.recipient ?? (isEmail ? item.agentEmail : item.agentPhone);
  const isDue = isQueued && !item.waitingOnId && new Date(item.dueAt).getTime() <= now;
  const recentlyContacted =
    item.lastContactedAt != null && now - new Date(item.lastContactedAt).getTime() < 7 * DAY_MS;

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  const handleSend = () => {
    if (isEmail) {
      run(async () => {
        const result = await sendQueuedEmail(item.id);
        if (result.error) toast.error(result.error);
        else toast.success(`Emailed ${item.agentName ?? to}`);
      });
      return;
    }
    // Same handoff as the Text button: open Messages first (it has to happen
    // inside the tap), then log it; the app asks on the way back whether it sent.
    window.location.href = smsUrl(to ?? "", item.body);
    run(() => markQueuedTextOpened(item.id));
    toast.success("Opened Messages — I'll ask if it sent");
  };

  return (
    <Card className="p-4 gap-2">
      <div className="flex items-start gap-2">
        {isEmail ? (
          <Mail className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
        ) : (
          <MessageCircle className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {item.agentName ?? "Unknown agent"}
            {item.listingAddress && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {item.listingAddress}
                {item.listingCity ? `, ${item.listingCity}` : ""}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {isEmail ? "Email" : "Text"} · {to ?? (isEmail ? "no email on file" : "no phone on file")}
            {item.presetName ? ` · ${item.presetName}` : ""}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {item.status === "sent"
            ? `Sent ${formatWhen(item.sentAt!)}`
            : item.status === "skipped"
              ? "Skipped"
              : item.waitingOnId
                ? "After previous step"
                : isDue
                  ? "Due"
                  : relative(item.dueAt, now)}
        </Badge>
      </div>

      {(item.repliedSinceQueued || (isQueued && recentlyContacted) || item.waitingOnId) && (
        <div className="flex flex-wrap gap-1.5">
          {item.repliedSinceQueued && <Badge variant="destructive">Replied since queued</Badge>}
          {isQueued && recentlyContacted && (
            <Badge variant="secondary">Contacted {formatWhen(item.lastContactedAt!)}</Badge>
          )}
          {item.waitingOnId && (
            <Badge variant="secondary">
              <Link2 /> Waits for the earlier message
            </Badge>
          )}
        </div>
      )}

      {isEmail && item.subject && <p className="text-sm font-medium">{item.subject}</p>}
      <p className="text-sm text-foreground/90 whitespace-pre-wrap line-clamp-6">{item.body}</p>

      {isQueued ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={handleSend} disabled={isPending || !to}>
            <Send />
            {isEmail ? "Send email" : "Send text"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={isPending}>
            <Pencil />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(() => setQueuedMessageStatus(item.id, "skipped"))}
            disabled={isPending}
          >
            <SkipForward />
            Skip
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={() => run(() => deleteQueuedMessage(item.id))}
            disabled={isPending}
            aria-label="Delete"
          >
            <Trash2 />
          </Button>
        </div>
      ) : (
        item.status === "skipped" && (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(() => setQueuedMessageStatus(item.id, "queued"))}
              disabled={isPending}
            >
              <Undo2 />
              Put back in queue
            </Button>
          </div>
        )
      )}

      <EditQueuedDialog item={item} open={editing} onOpenChange={setEditing} />
    </Card>
  );
}
