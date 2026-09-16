"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, Images, Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateBookingDropboxFolderLink, getOrAssignGalleryToken } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BookingWithDetails } from "./BookedList";

/**
 * Client-gallery setup: paste a Dropbox shared-folder link once, then
 * generate a shareable /gallery/[token] URL that renders its photos live —
 * see src/app/gallery/[token]/page.tsx and src/lib/dropbox.ts. Generating
 * the token is separate from editing the link (getOrAssignGalleryToken vs.
 * updateBookingDropboxFolderLink) so correcting a mistyped Dropbox link
 * later never breaks a gallery URL already sent to a client.
 */
export function GallerySection({ booking }: { booking: BookingWithDetails }) {
  const [isPending, startTransition] = useTransition();
  const [editingLink, setEditingLink] = useState(!booking.dropboxFolderLink);
  const [linkInput, setLinkInput] = useState(booking.dropboxFolderLink ?? "");
  const [dropboxFolderLink, setDropboxFolderLink] = useState(booking.dropboxFolderLink);
  const [galleryToken, setGalleryToken] = useState(booking.galleryToken);
  const [copied, setCopied] = useState(false);

  // Computed after mount, not during render — window.location isn't
  // available during SSR, and reading it inline here would make the
  // server- and client-rendered HTML disagree on the first paint.
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const galleryUrl = galleryToken && origin ? `${origin}/gallery/${galleryToken}` : null;

  const handleSaveLink = () => {
    startTransition(async () => {
      await updateBookingDropboxFolderLink(booking.id, linkInput);
      setDropboxFolderLink(linkInput.trim() || null);
      setEditingLink(false);
      toast.success("Dropbox link saved");
    });
  };

  const handleGetLink = () => {
    startTransition(async () => {
      const token = await getOrAssignGalleryToken(booking.id);
      setGalleryToken(token);
    });
  };

  const handleCopy = async () => {
    if (!galleryUrl) return;
    await navigator.clipboard.writeText(galleryUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border-t pt-3 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Images className="size-3.5" />
        Client gallery
      </p>

      {editingLink ? (
        <div className="flex items-center gap-2">
          <Input
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="Dropbox shared folder link"
            className="flex-1"
            autoFocus
          />
          <Button size="sm" onClick={handleSaveLink} disabled={isPending}>
            Save
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground/90 truncate flex-1">{dropboxFolderLink}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={() => {
              setLinkInput(dropboxFolderLink ?? "");
              setEditingLink(true);
            }}
          >
            <Pencil />
            <span className="sr-only">Edit</span>
          </Button>
        </div>
      )}

      {!editingLink &&
        dropboxFolderLink &&
        (galleryToken ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <code className="text-sm font-mono flex-1 truncate">{galleryUrl ?? "Loading…"}</code>
            <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={handleCopy} disabled={!galleryUrl}>
              {copied ? <Check className="text-green-600" /> : <Copy />}
              <span className="sr-only">Copy</span>
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="self-start" onClick={handleGetLink} disabled={isPending}>
            <Images />
            {isPending ? "Generating…" : "Get client gallery link"}
          </Button>
        ))}
    </div>
  );
}
