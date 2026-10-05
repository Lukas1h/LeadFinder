"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { MessageCircle, Mail, Phone, RefreshCw, Paperclip } from "lucide-react";
import type { PresetType } from "@/db/schema";
import { getMessageOptions, sendMessage, draftAiPresetOption, type PresetOption } from "@/app/messageActions";
import { getComposeEmailOptions, sendListingEmail, draftAiEmailPresetOption } from "@/app/composeEmailActions";
import { startPendingCallForListing } from "@/app/agents/interactionActions";
import { AI_DRAFT_VARIANT_SENTINEL } from "@/lib/messageTemplate";
import { smsUrl, telUrl, firstName } from "@/lib/sms";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/**
 * One "Contact {name}" button covering both channels — text and email
 * were two separate buttons on every listing card (SendMessageDialog +
 * SendEmailDialog), which read as cluttered. Same underlying send logic
 * as those two, just under one trigger with a Text/Email tab switch;
 * each tab keeps its own state so flipping between them mid-edit doesn't
 * lose anything typed.
 */
export function SendContactDialog({
  listingId,
  type,
  agentPhone,
  agentEmail,
  agentName,
  address,
  city,
  trigger,
}: {
  listingId: string;
  type: PresetType;
  agentPhone: string | null;
  agentEmail: string | null;
  agentName: string | null;
  address: string | null;
  city: string | null;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"text" | "email">("text");

  // --- Text tab state (mirrors the old SendMessageDialog) ---
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsPresets, setSmsPresets] = useState<PresetOption[]>([]);
  const [smsSelectedPresetId, setSmsSelectedPresetId] = useState<string | null>(null);
  // Read by an in-flight AI draft to check it's still the selected template.
  const selectedSmsRef = useRef<string | null>(null);
  const selectedEmailRef = useRef<string | null>(null);
  const [editedText, setEditedText] = useState("");
  const [isDraftingAi, setIsDraftingAi] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [isSendingSms, setIsSendingSms] = useState(false);

  // --- Email tab state (mirrors the old SendEmailDialog) ---
  const [emailLoaded, setEmailLoaded] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailPresets, setEmailPresets] = useState<PresetOption[]>([]);
  const [emailSelectedPresetId, setEmailSelectedPresetId] = useState<string | null>(null);
  const [editedEmail, setEditedEmail] = useState("");
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const [isDraftingEmailAi, setIsDraftingEmailAi] = useState(false);
  const [emailAiInstruction, setEmailAiInstruction] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const loadEmailOptions = () => {
    setEmailLoading(true);
    setEmailPresets([]);
    setEmailSelectedPresetId(null);
    setEditedEmail(agentEmail ?? "");
    setEditedSubject("");
    setEditedBody("");
    setIsDraftingEmailAi(false);
    setEmailAiInstruction("");
    getComposeEmailOptions({ type, agentName, address, city, listingId }).then(({ presets }) => {
      setEmailPresets(presets);
      // Same as the text tab: the recommended template, Blank as the fallback.
      const blank = presets.find((p) => p.blank);
      const recommended = presets.find((p) => p.recommended);
      const initial = recommended ?? blank ?? presets[0] ?? null;
      selectedEmailRef.current = initial?.presetId ?? null;
      setEmailSelectedPresetId(initial?.presetId ?? null);
      setEmailLoading(false);
      setEmailLoaded(true);
      if (initial?.variantId === AI_DRAFT_VARIANT_SENTINEL && !initial.subject) void startEmailAiDraft(initial.presetId);
      else {
        setEditedSubject(initial?.subject ?? "");
        setEditedBody(initial?.text ?? "");
      }
    });
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setMode("text");
    setSmsLoading(true);
    setSmsPresets([]);
    setSmsSelectedPresetId(null);
    setEditedText("");
    setIsDraftingAi(false);
    setAiInstruction("");
    setEmailLoaded(false);
    setIsDraftingEmailAi(false);
    setEmailAiInstruction("");
    getMessageOptions(listingId, type).then(({ presets }) => {
      setSmsPresets(presets);
      // The recommended template first — they're written for the listing's
      // section now (Coming Soon, Bad Photos, Backup…). Blank only when
      // nothing is recommended.
      const blank = presets.find((p) => p.blank);
      const recommended = presets.find((p) => p.recommended);
      const initial = recommended ?? blank ?? presets[0] ?? null;
      selectedSmsRef.current = initial?.presetId ?? null;
      setSmsSelectedPresetId(initial?.presetId ?? null);
      setSmsLoading(false);
      // A recommended AI draft (price cut / sitting listings) drafts right away.
      if (initial?.variantId === AI_DRAFT_VARIANT_SENTINEL && !initial.text) void startAiDraft(initial.presetId);
      else setEditedText(initial?.text ?? "");
    });
  };

  const handleModeChange = (next: string) => {
    setMode(next as "text" | "email");
    if (next === "email" && !emailLoaded && !emailLoading) loadEmailOptions();
  };

  const selectedSms = smsPresets.find((p) => p.presetId === smsSelectedPresetId) ?? null;
  const selectedEmail = emailPresets.find((p) => p.presetId === emailSelectedPresetId) ?? null;
  const callHref = telUrl(agentPhone);

  const startAiDraft = async (presetId: string) => {
    setEditedText("");
    setIsDraftingAi(true);
    const drafted = await draftAiPresetOption(listingId, type);
    setIsDraftingAi(false);
    // Switched to another template while it was drafting — don't clobber it.
    if (selectedSmsRef.current !== presetId) return;
    if (!drafted) {
      toast.error("AI draft failed — pick another preset or try again.");
      return;
    }
    setSmsPresets((prev) => prev.map((p) => (p.presetId === presetId ? drafted : p)));
    setEditedText(drafted.text);
  };

  const handleSelectSmsPreset = async (presetId: string) => {
    selectedSmsRef.current = presetId;
    setSmsSelectedPresetId(presetId);
    const option = smsPresets.find((p) => p.presetId === presetId);

    if (option?.variantId === AI_DRAFT_VARIANT_SENTINEL && !option.text) {
      await startAiDraft(presetId);
      return;
    }

    setEditedText(option?.text ?? "");
  };

  const handleRegenerateAi = async () => {
    if (!selectedSms) return;
    setIsDraftingAi(true);
    const drafted = await draftAiPresetOption(listingId, type, aiInstruction.trim() || undefined);
    setIsDraftingAi(false);
    if (!drafted) {
      toast.error("AI draft failed — try again.");
      return;
    }
    setSmsPresets((prev) => prev.map((p) => (p.presetId === selectedSms.presetId ? drafted : p)));
    setEditedText(drafted.text);
  };

  const handleSendSms = () => {
    if (!selectedSms) return;
    window.location.href = smsUrl(agentPhone ?? "", editedText);
    setIsSendingSms(true);
    sendMessage(listingId, type, selectedSms.presetId, selectedSms.variantId, editedText).then(() => {
      setIsSendingSms(false);
    });
    // No toast here — this only opened the Messages composer. Coming back to
    // the app confirms it with "Message sent", which has the Undo for a text
    // that never went (see PendingInteractionPrompt).
    setOpen(false);
  };

  // Same handoff problem as the text button: tapping Call opens the dialer and
  // the app can't see whether they picked up. Park an unresolved interaction so
  // the call isn't lost, and let the return prompt fill in the outcome.
  const handleCall = () => {
    startPendingCallForListing(listingId).catch(() => {});
    setOpen(false);
  };

  const startEmailAiDraft = async (presetId: string) => {
    setEditedSubject("");
    setEditedBody("");
    setIsDraftingEmailAi(true);
    const drafted = await draftAiEmailPresetOption(listingId, type);
    setIsDraftingEmailAi(false);
    if (selectedEmailRef.current !== presetId) return;
    if (!drafted) {
      toast.error("AI draft failed — pick another preset or try again.");
      return;
    }
    setEmailPresets((prev) => prev.map((p) => (p.presetId === presetId ? drafted : p)));
    setEditedSubject(drafted.subject ?? "");
    setEditedBody(drafted.text ?? "");
  };

  const handleSelectEmailPreset = async (presetId: string) => {
    selectedEmailRef.current = presetId;
    setEmailSelectedPresetId(presetId);
    const option = emailPresets.find((p) => p.presetId === presetId);

    if (option?.variantId === AI_DRAFT_VARIANT_SENTINEL && !option.subject) {
      await startEmailAiDraft(presetId);
      return;
    }

    setEditedSubject(option?.subject ?? "");
    setEditedBody(option?.text ?? "");
  };

  const handleRegenerateEmailAi = async () => {
    if (!selectedEmail) return;
    setIsDraftingEmailAi(true);
    const drafted = await draftAiEmailPresetOption(listingId, type, emailAiInstruction.trim() || undefined);
    setIsDraftingEmailAi(false);
    if (!drafted) {
      toast.error("AI draft failed — try again.");
      return;
    }
    setEmailPresets((prev) => prev.map((p) => (p.presetId === selectedEmail.presetId ? drafted : p)));
    setEditedSubject(drafted.subject ?? "");
    setEditedBody(drafted.text ?? "");
  };

  const handleSendEmail = () => {
    if (!selectedEmail) return;
    setIsSendingEmail(true);
    sendListingEmail({
      listingId,
      type,
      presetId: selectedEmail.presetId,
      variantId: selectedEmail.variantId,
      agentEmail: editedEmail,
      agentName,
      subject: editedSubject,
      body: editedBody,
    }).then((result) => {
      setIsSendingEmail(false);
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
          <DialogTitle>Contact {firstName(agentName) ?? "agent"}</DialogTitle>
          <DialogDescription>
            Pick a preset — the variant rotates automatically to keep your A/B stats fair.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={handleModeChange}>
          <TabsList className="w-full">
            <TabsTrigger value="text" className="gap-1.5">
              <MessageCircle className="size-3.5" />
              Text
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-1.5">
              <Mail className="size-3.5" />
              Email
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text">
            {smsLoading ? (
              <p className="text-sm text-muted-foreground py-4">Loading…</p>
            ) : smsPresets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No active preset for this message.{" "}
                <Link href="/messaging" className="underline">
                  Set one up on the Messaging page
                </Link>
                .
              </p>
            ) : (
              <div className="flex flex-col gap-4 py-2">
                {smsPresets.length > 1 && (
                  <Select value={smsSelectedPresetId ?? undefined} onValueChange={handleSelectSmsPreset}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {smsPresets.map((p) => (
                        <SelectItem key={p.presetId} value={p.presetId}>
                          {p.presetName}
                          {p.recommended && " (Recommended)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {selectedSms &&
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

                {selectedSms?.variantId === AI_DRAFT_VARIANT_SENTINEL && !isDraftingAi && (
                  <div className="flex items-center gap-2">
                    <Input
                      value={aiInstruction}
                      onChange={(e) => setAiInstruction(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleRegenerateAi();
                        }
                      }}
                      placeholder="Don't like it? Tell it what to change…"
                      className="text-sm flex-1"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={handleRegenerateAi}>
                      <RefreshCw />
                      Regenerate
                    </Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="email">
            {emailLoading ? (
              <p className="text-sm text-muted-foreground py-4">Loading…</p>
            ) : emailPresets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No active email template for this message.{" "}
                <Link href="/messaging" className="underline">
                  Set one up on the Messaging page
                </Link>
                .
              </p>
            ) : (
              <div className="flex flex-col gap-4 py-2">
                {emailPresets.length > 1 && (
                  <Select value={emailSelectedPresetId ?? undefined} onValueChange={handleSelectEmailPreset}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {emailPresets.map((p) => (
                        <SelectItem key={p.presetId} value={p.presetId}>
                          {p.presetName}
                          {p.recommended && " (Recommended)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {selectedEmail && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="email-to" className="text-xs text-muted-foreground">
                        To
                      </Label>
                      <Input
                        id="email-to"
                        type="email"
                        value={editedEmail}
                        onChange={(e) => setEditedEmail(e.target.value)}
                        placeholder="agent@example.com"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="email-subject" className="text-xs text-muted-foreground">
                        Subject
                      </Label>
                      {isDraftingEmailAi ? (
                        <p className="text-sm text-muted-foreground py-2">Drafting…</p>
                      ) : (
                        <Input
                          id="email-subject"
                          value={editedSubject}
                          onChange={(e) => setEditedSubject(e.target.value)}
                        />
                      )}
                    </div>
                    {isDraftingEmailAi ? (
                      <p className="text-sm text-muted-foreground py-4">Drafting…</p>
                    ) : (
                      <Textarea
                        value={editedBody}
                        onChange={(e) => setEditedBody(e.target.value)}
                        rows={8}
                        className="text-sm resize-none"
                      />
                    )}

                    {selectedEmail.variantId === AI_DRAFT_VARIANT_SENTINEL && !isDraftingEmailAi && (
                      <div className="flex items-center gap-2">
                        <Input
                          value={emailAiInstruction}
                          onChange={(e) => setEmailAiInstruction(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleRegenerateEmailAi();
                            }
                          }}
                          placeholder="Don't like it? Tell it what to change…"
                          className="text-sm flex-1"
                        />
                        <Button type="button" variant="outline" size="sm" onClick={handleRegenerateEmailAi}>
                          <RefreshCw />
                          Regenerate
                        </Button>
                      </div>
                    )}

                    {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedEmail.attachments.map((a) => (
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
          </TabsContent>
        </Tabs>

        <DialogFooter>
          {mode === "text" ? (
            <>
              {callHref && (
                <Button variant="outline" asChild onClick={handleCall}>
                  <a href={callHref}>
                    <Phone />
                    Call
                  </a>
                </Button>
              )}
              <Button
                onClick={handleSendSms}
                disabled={!selectedSms || !editedText.trim() || isSendingSms || isDraftingAi}
              >
                <MessageCircle />
                Send text
              </Button>
            </>
          ) : (
            <Button
              onClick={handleSendEmail}
              disabled={
                !selectedEmail ||
                !editedEmail.trim() ||
                !editedSubject.trim() ||
                !editedBody.trim() ||
                isSendingEmail ||
                isDraftingEmailAi
              }
            >
              <Mail />
              {isSendingEmail ? "Sending…" : "Send email"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
