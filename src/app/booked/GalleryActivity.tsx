"use client";

import { useEffect, useState } from "react";
import { Eye, Download, Film, Link2 } from "lucide-react";
import { getGalleryActivity, type GalleryActivityItem } from "./actions";

function formatWhen(date: Date): string {
  return new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const EVENT_LABELS: Record<GalleryActivityItem["event"], string> = {
  view: "Opened the gallery",
  download_all: "Downloaded all (.zip)",
  download_video: "Downloaded a video",
};

/**
 * Who has opened the client gallery and downloaded from it — the booking
 * detail dialog's "Gallery activity". Loaded when the dialog opens. Link
 * previews (iMessage fetching the link to draw its card) are kept but dimmed
 * and left out of the summary, since no person opened anything.
 */
export function GalleryActivity({ bookingId, open }: { bookingId: string; open: boolean }) {
  const [loaded, setLoaded] = useState<{ bookingId: string; items: GalleryActivityItem[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getGalleryActivity(bookingId).then((items) => {
      if (!cancelled) setLoaded({ bookingId, items });
    });
    return () => {
      cancelled = true;
    };
  }, [open, bookingId]);

  const items = loaded?.bookingId === bookingId ? loaded.items : null;
  const real = items?.filter((i) => !i.isPreview) ?? [];
  const opens = real.filter((i) => i.event === "view");
  const devices = new Set(opens.map((i) => `${i.ip}|${i.device}|${i.browser}`)).size;
  const downloads = real.filter((i) => i.event !== "view").length;

  return (
    <div className="border-t pt-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground">Gallery activity</p>
        {items && real.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Opened {opens.length}× on {devices} device{devices === 1 ? "" : "s"}
            {downloads > 0 && ` · ${downloads} download${downloads === 1 ? "" : "s"}`}
          </p>
        )}
      </div>

      {items === null ? (
        <p className="text-sm text-muted-foreground/70">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">Nobody has opened the gallery yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border/70 max-h-72 overflow-y-auto">
          {items.map((item) => {
            const Icon = item.isPreview ? Link2 : item.event === "view" ? Eye : item.event === "download_video" ? Film : Download;
            return (
              <div key={item.id} className={`flex items-start gap-2.5 py-2 ${item.isPreview ? "opacity-50" : ""}`}>
                <Icon className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">
                    {item.isPreview ? "Link preview (not a person)" : EVENT_LABELS[item.event]}
                    {item.event === "download_video" && item.detail && (
                      <span className="text-muted-foreground"> · {item.detail}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[item.isPreview ? null : `${item.device} · ${item.browser}`, item.location, item.ip]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatWhen(item.at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
