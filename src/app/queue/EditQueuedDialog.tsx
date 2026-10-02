"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateQueuedMessage, type QueueItem } from "./actions";

/** "2026-10-02T14:30" in the browser's local time, for a datetime-local input. */
function toLocalInput(date: Date): string {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditQueuedDialog({
  item,
  open,
  onOpenChange,
}: {
  item: QueueItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isEmail = item.channel === "email";
  const [subject, setSubject] = useState(item.subject ?? "");
  const [body, setBody] = useState(item.body);
  const [recipient, setRecipient] = useState(item.recipient ?? "");
  const [sendAfter, setSendAfter] = useState(toLocalInput(item.sendAfter));
  const [isPending, startTransition] = useTransition();

  const handleSave = () =>
    startTransition(async () => {
      const result = await updateQueuedMessage(item.id, {
        subject: isEmail ? subject : null,
        body,
        recipient,
        sendAfter: sendAfter ? new Date(sendAfter) : new Date(),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit queued {isEmail ? "email" : "text"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="queued-recipient">{isEmail ? "Email" : "Phone"}</Label>
            <Input
              id="queued-recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={(isEmail ? item.agentEmail : item.agentPhone) ?? (isEmail ? "name@example.com" : "Phone")}
            />
          </div>
          {isEmail && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="queued-subject">Subject</Label>
              <Input id="queued-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="queued-body">Message</Label>
            <Textarea id="queued-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="queued-send-after">Send after</Label>
            <Input
              id="queued-send-after"
              type="datetime-local"
              value={sendAfter}
              onChange={(e) => setSendAfter(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
