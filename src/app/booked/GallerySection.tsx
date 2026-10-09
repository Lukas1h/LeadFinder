"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CreditCard, ImagePlus, Images } from "lucide-react";
import { getOrAssignGalleryToken, getOrCreatePaymentLink } from "./actions";
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

/**
 * Makes (or reuses) the booking's Stripe payment link and copies it. Once it
 * exists, the client gallery shows a "Pay online" button for it too. A link
 * made for an older total is replaced on the next click.
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

  const current = booking.paymentLinkUrl && booking.paymentLinkAmount === total;
  const handleClick = () => {
    startTransition(async () => {
      const result = await getOrCreatePaymentLink(booking.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      if (!current) router.refresh();
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      {copied ? <Check className="text-green-600" /> : <CreditCard />}
      {isPending
        ? "Generating…"
        : copied
          ? "Copied!"
          : current
            ? "Copy payment link"
            : booking.paymentLinkUrl
              ? "Update payment link"
              : "Create payment link"}
    </Button>
  );
}
