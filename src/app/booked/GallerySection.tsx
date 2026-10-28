"use client";

import { GALLERY_ORIGIN } from "@/lib/siteUrls";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Share2, CreditCard, ImagePlus, Images, Sofa } from "lucide-react";
import { getOrAssignGalleryToken, getOrAssignShareToken, getOrCreatePayLink, setStagingRequestsEnabled } from "./actions";
import { Button } from "@/components/ui/button";
import type { BookingWithDetails } from "./BookedList";

// The client-facing link always points at the dedicated gallery subdomain
// (see src/middleware.ts), never window.location.origin — the admin app
// itself can be reached from several hosts (the stable Vercel alias, the
// .vercel.app preview domain, realestate.lukashahn.art), but a link handed
// to a client should only ever be the one subdomain that has no admin nav
// and bounces a stripped-down/invalid URL back to the real business site
// (GALLERY_ORIGIN, lib/siteUrls.ts).

/**
 * Lives in the dialog's top action row, next to Invoice/Edit. Two states:
 * no Dropbox folder set yet → "Add gallery" opens Edit, where the folder
 * link itself is set (see BookingForm.tsx); once set → one button that
 * assigns the galleryToken on first click if needed (same lazy-assign-once
 * shape as the invoice number), then copies the gallery.lukashahn.media URL
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

/**
 * Whether the client gallery offers "Request virtual staging" — off by
 * default, turned on per booking for clients it's offered to.
 */
export function StagingToggleButton({ booking }: { booking: BookingWithDetails }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(booking.stagingRequestsEnabled);
  if (!booking.dropboxFolderLink) return null;

  const handleClick = () => {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      await setStagingRequestsEnabled(booking.id, next);
      toast.success(next ? "Gallery now offers virtual staging" : "Virtual staging hidden from gallery");
      router.refresh();
    });
  };

  return (
    <Button variant={enabled ? "secondary" : "outline"} size="sm" onClick={handleClick} disabled={isPending}>
      {enabled ? <Check className="text-green-600" /> : <Sofa />}
      {enabled ? "Staging on gallery" : "Offer staging"}
    </Button>
  );
}

/**
 * Copies the invoice's Square "Pay Online" link, invoicing the booking first
 * if needed (lib/squareInvoice.ts keeps it at the current total). The invoice
 * and the client gallery show the same link as their "Pay online" button.
 */
export function PaymentLinkButton({ booking }: { booking: BookingWithDetails }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const total = booking.lineItems.reduce((sum, li) => sum + li.amount, 0);

  if (booking.paidAt) {
    return (
      <Button variant="outline" size="sm" disabled>
        <Check className="text-green-600" />
        Paid online
      </Button>
    );
  }
  if (total <= 0) return null;

  const handleClick = () => {
    startTransition(async () => {
      const result = await getOrCreatePayLink(booking.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      if (result.url !== booking.squareInvoiceUrl) router.refresh();
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      {copied ? <Check className="text-green-600" /> : <CreditCard />}
      {isPending ? "Checking Square…" : copied ? "Copied!" : "Copy pay link"}
    </Button>
  );
}

/**
 * "Copy share link": the same gallery for someone who isn't the client
 * (showing the listing off), with no invoice or payment and the first photo
 * as a hero. Its visits show in Gallery activity as "Share link opened".
 */
export function ShareGalleryButton({ booking }: { booking: BookingWithDetails }) {
  const [isPending, startTransition] = useTransition();
  const [shareToken, setShareToken] = useState(booking.shareToken);
  const [copied, setCopied] = useState(false);
  if (!booking.dropboxFolderLink) return null;

  const handleClick = () => {
    startTransition(async () => {
      const token = shareToken ?? (await getOrAssignShareToken(booking.id));
      if (!shareToken) setShareToken(token);
      await navigator.clipboard.writeText(`${GALLERY_ORIGIN}/${token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      {copied ? <Check className="text-green-600" /> : <Share2 />}
      {isPending ? "Generating…" : copied ? "Copied!" : "Copy share link"}
    </Button>
  );
}
