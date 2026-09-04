"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import type { PresetType } from "@/db/schema";
import { getMessageOptions, sendMessage, type PresetOption } from "@/app/messageActions";
import { smsUrl } from "@/lib/sms";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  const [presets, setPresets] = useState<PresetOption[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setLoading(true);
    setPresets([]);
    setSelectedPresetId(null);
    setEditedText("");
    getMessageOptions(listingId, type).then(({ presets }) => {
      setPresets(presets);
      const recommended = presets.find((p) => p.recommended);
      const initial = recommended ?? presets[0] ?? null;
      setSelectedPresetId(initial?.presetId ?? null);
      setEditedText(initial?.text ?? "");
      setLoading(false);
    });
  };

  const selected = presets.find((p) => p.presetId === selectedPresetId) ?? null;

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    setEditedText(presets.find((p) => p.presetId === presetId)?.text ?? "");
  };

  const handleSend = () => {
    if (!selected) return;
    const url = smsUrl(agentPhone ?? "", editedText);
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
            Pick a preset — the variant rotates automatically to keep your A/B stats fair.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : presets.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No active preset for this message.{" "}
            <Link href="/presets" className="underline">
              Set one up on the Presets page
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            {presets.length > 1 && (
              <Select value={selectedPresetId ?? undefined} onValueChange={handleSelectPreset}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.presetId} value={p.presetId}>
                      {p.presetName}
                      {p.recommended && " (Recommended)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selected && (
              <Textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                rows={5}
                className="text-sm resize-none"
              />
            )}
          </div>
        )}

        <DialogFooter>
          <Button onClick={handleSend} disabled={!selected || !editedText.trim() || isPending}>
            <MessageCircle />
            Send text
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
