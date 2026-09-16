"use client";

import { useState, useTransition } from "react";
import { Check, ImagePlus, Images } from "lucide-react";
import { getOrAssignGalleryToken } from "./actions";
import { Button } from "@/components/ui/button";
import type { BookingWithDetails } from "./BookedList";

/**
 * Lives in the dialog's top action row, next to Invoice/Edit. Two states:
 * no Dropbox folder set yet → "Add gallery" opens Edit, where the folder
 * link itself is set (see BookingForm.tsx); once set → one button that
 * assigns the galleryToken on first click if needed (same lazy-assign-once
 * shape as the invoice number), then copies the full /gallery/[token] URL
 * — no separate URL display taking up space, the URL only ever goes to
 * the clipboard.
 */
export function GalleryLinkButton({ booking, onAddGallery }: { booking: BookingWithDetails; onAddGallery: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [galleryToken, setGalleryToken] = useState(booking.galleryToken);
  const [copied, setCopied] = useState(false);

  if (!booking.dropboxFolderLink) {
    return (
      <Button variant="outline" size="sm" onClick={onAddGallery}>
        <ImagePlus />
        Add gallery
      </Button>
    );
  }

  const handleClick = () => {
    startTransition(async () => {
      const token = galleryToken ?? (await getOrAssignGalleryToken(booking.id));
      if (!galleryToken) setGalleryToken(token);
      await navigator.clipboard.writeText(`${window.location.origin}/gallery/${token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      {copied ? <Check className="text-green-600" /> : <Images />}
      {isPending ? "Generating…" : copied ? "Copied!" : "Copy gallery link"}
    </Button>
  );
}
