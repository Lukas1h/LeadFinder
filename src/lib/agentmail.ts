/**
 * Fallback for src/app/api/webhooks/agentmail/route.ts — a real forwarded
 * email (Fwd: New Listing: 1466 SE Pine St, 2026-09-04) delivered a
 * `message.received` webhook whose inline `message.html`/`message.text`
 * didn't contain the zpid link the same message's body has when read back
 * through this REST endpoint, so the webhook silently no-op'd. AgentMail's
 * docs don't document a size cap or truncation rule for the inline body,
 * so rather than guess at one, re-fetch the message directly whenever the
 * webhook's inline body comes up empty.
 */
export async function fetchAgentMailMessage(
  inboxId: string,
  messageId: string
): Promise<{ html?: string; text?: string } | null> {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    console.error("AGENTMAIL_API_KEY is not set");
    return null;
  }

  const url = `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error("agentmail message fetch failed", res.status, await res.text());
    return null;
  }

  return res.json();
}
