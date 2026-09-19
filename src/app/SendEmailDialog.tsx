"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Mail, Paperclip } from "lucide-react";
import type { PresetType } from "@/db/schema";
import { getComposeEmailOptions, sendListingEmail } from "@/app/composeEmailActions";
import type { PresetOption } from "@/app/messageActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Mirrors SendMessageDialog's shape (load on open, pick a preset, edit,
// send) plus a Subject field — the one thing an email needs that a text
// doesn't. No AI draft/regenerate here yet, unlike the SMS dialog: email
// currently sends from a picked template, not a live per-listing draft.
export function SendEmailDialog({
  listingId,
  type,
  agentEmail,
  agentName,
  address,
  trigger,
}: {
  listingId: string;
  type: PresetType;
  agentEmail: string;
  agentName: string | null;
  address: string | null;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [presets, setPresets] = useState<PresetOption[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setLoading(true);
    setPresets([]);
    setSelectedPresetId(null);
    setEditedSubject("");
    setEditedBody("");
    getComposeEmailOptions({ type, agentName, address }).then(({ presets }) => {
      setPresets(presets);
      const blank = presets.find((p) => p.blank);
      const recommended = presets.find((p) => p.recommended);
      const initial = blank ?? recommended ?? presets[0] ?? null;
      setSelectedPresetId(initial?.presetId ?? null);
      setEditedSubject(initial?.subject ?? "");
      setEditedBody(initial?.text ?? "");
      setLoading(false);
    });
  };

  const selected = presets.find((p) => p.presetId === selectedPresetId) ?? null;

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const option = presets.find((p) => p.presetId === presetId);
    setEditedSubject(option?.subject ?? "");
    setEditedBody(option?.text ?? "");
  };

  const handleSend = () => {
    if (!selected) return;
    setIsSending(true);
    sendListingEmail({
      listingId,
      type,
      presetId: selected.presetId,
      variantId: selected.variantId,
      agentEmail,
      agentName,
      subject: editedSubject,
      body: editedBody,
    }).then((result) => {
      setIsSending(false);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Email sent");
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send email</DialogTitle>
          <DialogDescription>
            Pick a template — the variant rotates automatically to keep your A/B stats fair.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : presets.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No active email template for this message.{" "}
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
            {selected && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email-subject" className="text-xs text-muted-foreground">
                    Subject
                  </Label>
                  <Input id="email-subject" value={editedSubject} onChange={(e) => setEditedSubject(e.target.value)} />
                </div>
                <Textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  rows={8}
                  className="text-sm resize-none"
                />
                {selected.attachments && selected.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.attachments.map((a) => (
                      <Badge key={a.id} variant="secondary" className="gap-1">
                        <Paperclip className="size-3" />
                        {a.filename}
                      </Badge>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={handleSend}
            disabled={!selected || !editedSubject.trim() || !editedBody.trim() || isSending}
          >
            <Mail />
            {isSending ? "Sending…" : "Send email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
