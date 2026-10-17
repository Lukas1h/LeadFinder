import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for the SMTP app passwords in email_accounts.
 *
 * These are live credentials for real mailboxes, so they are stored as
 * AES-256-GCM ciphertext rather than plaintext: a leaked database dump, a
 * `SELECT *` in the Supabase-style dashboard, or a stray backup is not enough
 * to send mail as Lukas. GCM is authenticated, so a tampered row fails to
 * decrypt instead of yielding garbage — the ciphertext is its own integrity
 * check.
 *
 * Same construction as the unsubscribe tokens in lib/unsubscribe.ts (iv, auth
 * tag, then ciphertext, base64url), kept in its own module because that one
 * encrypts a recipient address for a URL and this one encrypts a password for
 * a database row. Don't merge them: they should not share a key.
 */

const ALGORITHM = "aes-256-gcm";

/**
 * Falls back to UNSUBSCRIBE_SECRET so an environment that already has that
 * set (both prod and the documented setup do) can store accounts without a
 * second secret to provision. MAILBOX_SECRET is preferred and is what a fresh
 * install should set — rotating it later makes existing rows undecryptable,
 * which surfaces as "could not decrypt" rather than a silent bad password.
 */
function key(): Buffer {
  const value = process.env.MAILBOX_SECRET ?? process.env.UNSUBSCRIBE_SECRET;
  if (!value) throw new Error("MAILBOX_SECRET / UNSUBSCRIBE_SECRET is not set");
  // Fixed 32 bytes for AES-256 regardless of the secret's own length.
  return createHash("sha256").update(value).digest();
}

/** Opaque, URL-safe ciphertext. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

/**
 * Throws if the value isn't one of ours — a wrong key (rotated MAILBOX_SECRET)
 * and a corrupted row are indistinguishable here, and both mean the same thing
 * to the caller: re-enter the password.
 */
export function decryptSecret(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, "base64url");
  // iv (12) + auth tag (16) + at least one byte of ciphertext
  if (raw.length < 29) throw new Error("stored password is malformed");
  const decipher = createDecipheriv(ALGORITHM, key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
