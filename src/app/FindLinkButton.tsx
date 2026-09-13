"use client";

import { useState } from "react";
import { Search, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A button that resolves a URL on first click and becomes a real link once
 * it has one — used by the Realtor.com/Redfin listing buttons and the
 * agent-profile button. Three states, cycling once per resolve:
 *  - idle: "Find {label}" — plain button, onClick runs the lookup.
 *  - loading: "Finding…" — disabled while the lookup runs.
 *  - resolved: a real <a href target="_blank"> (required for iOS — see
 *    ListingModal/AgentDetailDialog's comments on why this can't be a
 *    JS-driven window.open), briefly labeled "Found!" then settling on
 *    "Open {label}".
 * Starts straight in the resolved state when `initialUrl` is already known
 * (the common case once something's been looked up before — cached on the
 * listing/agent row), so most clicks in practice are a single, ordinary tap
 * on a real link with no lookup at all.
 */
export function FindLinkButton({
  label,
  initialUrl,
  onFind,
  className,
}: {
  /** Short noun used in both "Find {label}" and "Open {label}", e.g. "Redfin", "profile". */
  label: string;
  initialUrl: string | null;
  /** Resolves to a URL to use — callers handle their own fallback, this never rejects to nothing. */
  onFind: () => Promise<string>;
  className?: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [state, setState] = useState<"idle" | "loading" | "found">("idle");

  const handleClick = async () => {
    setState("loading");
    const resolved = await onFind();
    setUrl(resolved);
    setState("found");
    setTimeout(() => setState("idle"), 1200);
  };

  if (url) {
    return (
      <Button variant="outline" size="sm" asChild className={className}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          {state === "found" ? (
            <>
              <Check />
              Found!
            </>
          ) : (
            <>
              Open {label}
              <ExternalLink />
            </>
          )}
        </a>
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={state === "loading"} className={className}>
      <Search />
      {state === "loading" ? "Finding…" : `Find ${label}`}
    </Button>
  );
}
