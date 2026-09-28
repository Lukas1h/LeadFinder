import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * List-Unsubscribe token handling for the cold-email campaigns.
 *
 * CAN-SPAM requires commercial email to carry a working opt-out, and Gmail and
 * Yahoo additionally require the RFC 8058 one-click pair
 * (List-Unsubscribe + List-Unsubscribe-Post) before they'll deliver bulk mail
 * at volume. So the header isn't cosmetic here: pointing it at a URL that
 * doesn't unsubscribe anyone is worse than omitting it, because it advertises
 * an opt-out that lies.
 *
 * The recipient's address is encrypted into the token rather than passed as a
 * query parameter. A `?email=` link would work, but the address would then sit
 * in web server logs, proxy logs and browser history for every one of the
 * thousands of people who receive a campaign, and anyone could hand-edit it to
 * unsubscribe somebody else. AES-GCM is authenticated, so a tampered or
 * forged token fails to decrypt and is rejected — the ciphertext is its own
 * integrity check.
 */

const BASE_URL = (process.env.APP_URL ?? "https://realestate.lukashahn.art").replace(/\/+$/, "");

function key(): Buffer {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not set");
  // Fixed 32 bytes for AES-256 regardless of the secret's own length.
  return createHash("sha256").update(secret).digest();
}

export class UnsubscribedError extends Error {
  constructor(email: string) {
    super(`${email} has unsubscribed from email`);
    this.name = "UnsubscribedError";
  }
}

/** Opaque, URL-safe token that carries the address inside it. */
export function buildUnsubscribeToken(email: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(email.trim().toLowerCase(), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

/** Returns the address the token was issued for, or null if it isn't ours. */
export function readUnsubscribeToken(token: string): string | null {
  try {
    const raw = Buffer.from(token, "base64url");
    // iv (12) + auth tag (16) + ciphertext
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function unsubscribeUrl(email: string): string {
  return `${BASE_URL}/api/unsubscribe?t=${encodeURIComponent(buildUnsubscribeToken(email))}`;
}

/**
 * The two headers together. The mailto: is the fallback for clients that don't
 * do one-click — it has to be a real address that a human reads, which is why
 * it defaults to the sending mailbox rather than being invented.
 */
export function listUnsubscribeHeaders(email: string): Record<string, string> {
  const mailto = process.env.UNSUBSCRIBE_MAILTO ?? process.env.ICLOUD_EMAIL;
  return {
    "List-Unsubscribe": `<mailto:${mailto}>, <${unsubscribeUrl(email)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
