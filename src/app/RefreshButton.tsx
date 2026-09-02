"use client";

import { useState, useTransition } from "react";
import { triggerManualSync } from "./actions";

type State = "idle" | "confirming" | "done" | "error";

export function RefreshButton() {
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<{ fetched: number; inserted: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  if (state === "confirming") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-600">
          This calls Zillapi for real — costs a credit per listing returned, even ones you
          already have. Sure?
        </span>
        <button
          type="button"
          onClick={() => {
            startTransition(async () => {
              try {
                const r = await triggerManualSync();
                setResult(r);
                setState("done");
              } catch {
                setState("error");
              }
            });
          }}
          disabled={isPending}
          className="font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
        >
          {isPending ? "Checking…" : "Yes, check now"}
        </button>
        <button
          type="button"
          onClick={() => setState("idle")}
          disabled={isPending}
          className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (state === "done" && result) {
    return (
      <button
        type="button"
        onClick={() => setState("idle")}
        className="text-sm text-emerald-700 hover:underline"
      >
        Found {result.fetched}, added {result.inserted} new — refresh again?
      </button>
    );
  }

  if (state === "error") {
    return (
      <button
        type="button"
        onClick={() => setState("confirming")}
        className="text-sm text-red-600 hover:underline"
      >
        Something went wrong — try again?
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setState("confirming")}
      className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 4v6h-6M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
      Refresh
    </button>
  );
}
