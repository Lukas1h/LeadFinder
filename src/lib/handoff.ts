import type { PendingSend } from "@/db/schema";

// Every hand-off to another app (Messages, the phone dialer) goes through
// here. Two iOS PWA constraints shape it:
//   1. The other app can only be opened directly by the tap — navigating to
//      an sms:/tel: URL after an await is silently blocked. So the link opens
//      synchronously, never after waiting on the server.
//   2. The PWA is frozen the moment the other app opens, so an ordinary
//      request fired alongside can be lost (how Queue texts went unlogged).
//      A beacon is queued by the browser itself and delivered anyway.
// The beacon only records a pending "did it send?" question (see
// /api/handoff and startTextHandoff); nothing is committed until it's answered.

export type HandoffPayload =
  | { kind: "text"; agentId?: string | null; listingId?: string | null; send?: PendingSend["send"] }
  | { kind: "call"; agentId?: string | null; listingId?: string | null }
  | { kind: "queued"; queuedMessageId: string };

/** Fires the log for a hand-off. Synchronous — call it inside the tap, before navigating. */
export function logHandoff(payload: HandoffPayload): void {
  const body = JSON.stringify(payload);
  // text/plain keeps the beacon a "simple" request with no preflight.
  const sent = navigator.sendBeacon?.("/api/handoff", new Blob([body], { type: "text/plain" }));
  if (!sent) {
    void fetch("/api/handoff", { method: "POST", body, keepalive: true }).catch(() => {});
  }
}

/** Logs and opens in the same tap, for buttons that aren't a plain <a href>. */
export function openHandoff(url: string, payload: HandoffPayload): void {
  logHandoff(payload);
  window.location.href = url;
}
