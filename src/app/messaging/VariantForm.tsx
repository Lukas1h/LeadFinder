"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { MessagePresetVariant, MessageChannel } from "@/db/schema";
import { createVariant, updateVariant } from "./actions";
import { renderMessageBody, renderSubject } from "@/lib/messageTemplate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export function VariantForm({
  presetId,
  variant,
  channel,
  trigger,
}: {
  presetId: string;
  variant?: MessagePresetVariant;
  channel: MessageChannel;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [label, setLabel] = useState(variant?.label ?? "");
  const [subject, setSubject] = useState(variant?.subject ?? "");
  const [body, setBody] = useState(variant?.body ?? "");
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!variant;
  const isEmail = channel === "email";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = isEditing
      ? await updateVariant(variant.id, { label, body, subject: isEmail ? subject : undefined })
      : await createVariant(presetId, { label, body, subject: isEmail ? subject : undefined });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    toast.success(isEditing ? "Variant updated" : "Variant added");
    setOpen(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit variant" : "Add variant"}</DialogTitle>
            <DialogDescription>
              Use <code className="font-mono">{"{{firstName}}"}</code>
              {!isEmail && (
                <>
                  {" "}
                  and <code className="font-mono">{"{{street}}"}</code>
                </>
              )}{" "}
              to personalize — {isEmail ? "filled in from the name you enter when composing" : "they're filled in from the listing when a message is sent"}.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="variant-label">Label</Label>
              <Input
                id="variant-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. A, Casual, With urgency"
                required
              />
            </div>

            {isEmail && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="variant-subject">Subject</Label>
                <Input
                  id="variant-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Backup photographer for {{firstName}}'s listings"
                  required
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="variant-body">Message</Label>
              <Textarea
                id="variant-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={
                  isEmail
                    ? "Hi {{firstName}}, I'm Lukas…"
                    : "Hey {{firstName}}, I saw your listing on {{street}} go up…"
                }
                rows={isEmail ? 10 : 5}
                required
              />
            </div>

            {(body.trim() || subject.trim()) && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Preview</Label>
                {isEmail && subject.trim() && (
                  <p className="text-sm font-medium rounded-t-lg border border-input border-b-0 bg-muted/40 px-2.5 py-2">
                    {renderSubject(subject, "Sarah Nantucket")}
                  </p>
                )}
                <p
                  className={`text-sm border border-input bg-muted/40 px-2.5 py-2 whitespace-pre-wrap ${
                    isEmail && subject.trim() ? "rounded-b-lg" : "rounded-lg"
                  }`}
                >
                  {renderMessageBody(body, "Sarah Nantucket", "827 Nantucket Ave")}
                </p>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Add variant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
