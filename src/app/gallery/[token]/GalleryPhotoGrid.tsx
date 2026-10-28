"use client";

import { useState } from "react";
import { CheckCircle2, Sofa } from "lucide-react";
import { GalleryPhoto } from "./GalleryPhoto";

/**
 * The photo grid, plus "Request virtual staging": the client taps the photos
 * they want staged, adds an optional note, and sends — Lukas gets a push and
 * the picks land in the booking's gallery activity. He stages them himself.
 */
export function GalleryPhotoGrid({
  token,
  names,
  staging,
  hero = false,
}: {
  token: string;
  names: string[];
  staging: boolean;
  /** The share link's layout: the first photo full width above the grid. */
  hero?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const url = (name: string, size: string) => `/api/gallery/${token}/thumbnail?name=${encodeURIComponent(name)}&size=${size}`;
  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  async function send() {
    setState("sending");
    const res = await fetch(`/api/gallery/${token}/staging`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: [...selected], note }),
    }).catch(() => null);
    if (res?.ok) {
      setState("sent");
      setPicking(false);
      setSelected(new Set());
      setNote("");
    } else {
      setState("error");
    }
  }

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {state === "sent" ? (
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-green-700">
          <CheckCircle2 className="size-4" />
          Got it! I&rsquo;ll send the staged photos over soon.
        </p>
      ) : picking ? (
        <p className="text-sm text-[#181A1C]/70 text-center">Tap the photos you&rsquo;d like virtually staged.</p>
      ) : !staging ? null : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-[#181A1C]/15 px-5 py-2.5 text-sm font-semibold hover:bg-[#F9F4F1] transition-colors"
        >
          <Sofa className="size-4" />
          Request virtual staging
        </button>
      )}

      {hero && names[0] && (
        <a href={url(names[0], "w2048h1536")} target="_blank" rel="noopener noreferrer" className="block w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- proxied Dropbox photo */}
          <img
            src={url(names[0], "w2048h1536")}
            alt={names[0]}
            className="w-full aspect-[3/2] object-cover rounded-lg border border-[#181A1C]/10 bg-[#F9F4F1]"
          />
        </a>
      )}

      <div className={`w-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 ${picking ? "pb-48" : ""}`}>
        {(hero ? names.slice(1) : names).map((name) => (
          <GalleryPhoto
            key={name}
            name={name}
            thumbUrl={url(name, "w960h640")}
            fullUrl={url(name, "w2048h1536")}
            selected={selected.has(name)}
            onToggle={picking ? () => toggle(name) : undefined}
          />
        ))}
      </div>

      {picking && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[#181A1C]/10 bg-white/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-5xl mx-auto flex flex-col gap-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Any notes? (style, which rooms, etc.)"
              className="w-full rounded-lg border border-[#181A1C]/15 px-3 py-2 text-base sm:text-sm"
            />
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setPicking(false);
                  setSelected(new Set());
                  setState("idle");
                }}
                className="text-sm text-[#181A1C]/70 underline"
              >
                Cancel
              </button>
              <div className="flex items-center gap-3">
                {state === "error" && <span className="text-sm text-red-700">Didn&rsquo;t send. Try again?</span>}
                <button
                  type="button"
                  disabled={selected.size === 0 || state === "sending"}
                  onClick={send}
                  className="rounded-lg bg-[#181A1C] text-white px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
                >
                  {state === "sending"
                    ? "Sending…"
                    : `Send request${selected.size ? ` (${selected.size} photo${selected.size === 1 ? "" : "s"})` : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
