"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { MessagePresetVariant } from "@/db/schema";
import { createVariant, updateVariant } from "./actions";
import { renderMessageBody } from "@/lib/messageTemplate";
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
  trigger,
}: {
  presetId: string;
  variant?: MessagePresetVariant;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [label, setLabel] = useState(variant?.label ?? "");
  const [body, setBody] = useState(variant?.body ?? "");
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!variant;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = isEditing
      ? await updateVariant(variant.id, { label, body })
      : await createVariant(presetId, { label, body });

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
              Use <code className="font-mono">{"{{firstName}}"}</code> and{" "}
              <code className="font-mono">{"{{street}}"}</code> to personalize — they&rsquo;re filled
              in from the listing when a message is sent.
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

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="variant-body">Message</Label>
              <Textarea
                id="variant-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Hey {{firstName}}, I saw your listing on {{street}} go up…"
                rows={5}
                required
              />
            </div>

            {body.trim() && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Preview</Label>
                <p className="text-sm rounded-lg border border-input bg-muted/40 px-2.5 py-2 whitespace-pre-wrap">
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
