"use client";

import { useState, useTransition } from "react";
import { Check, ImagePlus, Images } from "lucide-react";
import { getOrAssignGalleryToken } from "./actions";
import { Button } from "@/components/ui/button";
import type { BookingWithDetails } from "./BookedList";

// The client-facing link always points at the dedicated gallery subdomain
// (see src/middleware.ts), never window.location.origin — the admin app
// itself can be reached from several hosts (the stable Vercel alias, the
// .vercel.app preview domain, realestate.lukashahn.art), but a link handed
// to a client should only ever be the one subdomain that has no admin nav
// and bounces a stripped-down/invalid URL back to the real business site.
const GALLERY_ORIGIN = "https://gallery.lukashahn.art";

/**
 * Lives in the dialog's top action row, next to Invoice/Edit. Two states:
 * no Dropbox folder set yet → "Add gallery" opens Edit, where the folder
 * link itself is set (see BookingForm.tsx); once set → one button that
 * assigns the galleryToken on first click if needed (same lazy-assign-once
 * shape as the invoice number), then copies the gallery.lukashahn.art URL
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
      await navigator.clipboard.writeText(`${GALLERY_ORIGIN}/${token}`);
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
