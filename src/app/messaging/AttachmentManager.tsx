"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip, X, Upload } from "lucide-react";
import type { PresetAttachment } from "@/db/schema";
import { uploadPresetAttachment, removePresetAttachment } from "./actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/** Files attached to every email sent from an email preset — see the schema comment on messagePresets.attachments. */
export function AttachmentManager({
  presetId,
  attachments,
}: {
  presetId: string;
  attachments: PresetAttachment[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.set("file", file);
    const result = await uploadPresetAttachment(presetId, formData);
    setIsUploading(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Attached "${file.name}"`);
    router.refresh();
  };

  const handleRemove = (url: string, filename: string) => {
    startTransition(async () => {
      await removePresetAttachment(presetId, url);
      toast.success(`Removed "${filename}"`);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attachments.map((a) => (
        <Badge key={a.url} variant="secondary" className="gap-1 pr-1">
          <Paperclip className="size-3" />
          {a.filename}
          <button
            type="button"
            onClick={() => handleRemove(a.url, a.filename)}
            disabled={isPending}
            className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
          >
            <X className="size-3" />
            <span className="sr-only">Remove {a.filename}</span>
          </button>
        </Badge>
      ))}
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 text-xs px-2"
        disabled={isUploading}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="size-3" />
        {isUploading ? "Uploading…" : "Attach file"}
      </Button>
    </div>
  );
}
