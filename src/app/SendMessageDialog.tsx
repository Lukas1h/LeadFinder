"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { MessageCircle, Phone } from "lucide-react";
import type { PresetType } from "@/db/schema";
import { getMessageOptions, sendMessage, draftAiPresetOption, type PresetOption } from "@/app/messageActions";
import { AI_DRAFT_VARIANT_SENTINEL } from "@/lib/messageTemplate";
import { smsUrl, telUrl } from "@/lib/sms";
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
  const [isDraftingAi, setIsDraftingAi] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setLoading(true);
    setPresets([]);
    setSelectedPresetId(null);
    setEditedText("");
    setIsDraftingAi(false);
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
  const callHref = telUrl(agentPhone);

  const handleSelectPreset = async (presetId: string) => {
    setSelectedPresetId(presetId);
    const option = presets.find((p) => p.presetId === presetId);

    // The AI option starts as an empty placeholder (see getMessageOptions)
    // so it can appear in the dropdown without costing a Gemini call on
    // every dialog open — only draft it for real the moment it's actually
    // picked.
    if (option?.variantId === AI_DRAFT_VARIANT_SENTINEL && !option.text) {
      setEditedText("");
      setIsDraftingAi(true);
      const drafted = await draftAiPresetOption(listingId, type);
      setIsDraftingAi(false);
      if (!drafted) {
        toast.error("AI draft failed — pick another preset or try again.");
        return;
      }
      setPresets((prev) => prev.map((p) => (p.presetId === presetId ? drafted : p)));
      setEditedText(drafted.text);
      return;
    }

    setEditedText(option?.text ?? "");
  };

  const handleSend = () => {
    if (!selected) return;
    window.location.href = smsUrl(agentPhone ?? "", editedText);
    startTransition(async () => {
      await sendMessage(listingId, type, selected.presetId, selected.variantId, editedText);
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
            <Link href="/messaging" className="underline">
              Set one up on the Messaging page
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
            {selected &&
              (isDraftingAi ? (
                <p className="text-sm text-muted-foreground py-4">Drafting…</p>
              ) : (
                <Textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  rows={5}
                  className="text-sm resize-none"
                />
              ))}
          </div>
        )}

        <DialogFooter>
          {callHref && (
            <Button variant="outline" asChild>
              <a href={callHref}>
                <Phone />
                Call
              </a>
            </Button>
          )}
          <Button onClick={handleSend} disabled={!selected || !editedText.trim() || isPending || isDraftingAi}>
            <MessageCircle />
            Send text
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
