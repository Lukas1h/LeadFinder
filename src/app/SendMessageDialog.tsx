"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import type { PresetType } from "@/db/schema";
import { getMessageOptions, sendMessage, type MessageOption } from "@/app/messageActions";
import { smsUrl } from "@/lib/sms";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SendMessageDialog({
  listingId,
  type,
  agentPhone,
  trigger,
}: {
  listingId: string;
  type: PresetType;
  agentPhone: string | null;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<MessageOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setLoading(true);
    setOptions([]);
    setSelectedId(null);
    getMessageOptions(listingId, type).then(({ options, pickedVariantId }) => {
      setOptions(options);
      setSelectedId(pickedVariantId ?? options[0]?.variantId ?? null);
      setLoading(false);
    });
  };

  if (!agentPhone) return null;

  const selected = options.find((o) => o.variantId === selectedId) ?? null;

  const handleSend = () => {
    if (!selected) return;
    const url = smsUrl(agentPhone, selected.text);
    if (url) window.location.href = url;
    startTransition(async () => {
      await sendMessage(listingId, type, selected.presetId, selected.variantId);
    });
    toast.success("Send logged");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send message</DialogTitle>
          <DialogDescription>
            Auto-picked to keep your variants balanced — swap it below if you&rsquo;d rather send
            something else.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No active preset for this message.{" "}
            <Link href="/presets" className="underline">
              Set one up on the Presets page
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            {options.length > 1 && (
              <Select value={selectedId ?? undefined} onValueChange={setSelectedId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.variantId} value={o.variantId}>
                      {o.presetName} — {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selected && (
              <p className="text-sm rounded-lg border border-input bg-muted/40 px-2.5 py-2 whitespace-pre-wrap">
                {selected.text}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button onClick={handleSend} disabled={!selected || isPending}>
            <MessageCircle />
            Send text
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
