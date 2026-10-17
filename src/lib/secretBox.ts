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
  const raw = process.env.MAILBOX_SECRET ?? process.env.UNSUBSCRIBE_SECRET;
  if (!raw) throw new Error("MAILBOX_SECRET / UNSUBSCRIBE_SECRET is not set");
  // Trimmed because a secret copied through a shell heredoc or a
  // `vercel env add` fed by stdin picks up a trailing newline, and a stray
  // "\n" changes the hash while looking identical in every listing. That
  // silently made every stored password undecryptable in production while the
  // local copy worked, so the whitespace can't be allowed to matter.
  return createHash("sha256").update(raw.trim()).digest();
}

/** Opaque, URL-safe ciphertext. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

/**
 * Throws if the value isn't one of ours. AES-GCM's "Unsupported state or
 * unable to authenticate data" is the symptom of a wrong key as well as a
 * corrupted row, and both mean the same thing to whoever reads it: the stored
 * password can't be trusted, so re-enter it. The wording says which.
 */
export function decryptSecret(ciphertext: string): string {
  try {
    const raw = Buffer.from(ciphertext, "base64url");
    // iv (12) + auth tag (16) + at least one byte of ciphertext
    if (raw.length < 29) throw new Error("malformed");
    const decipher = createDecipheriv(ALGORITHM, key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(
      "Could not decrypt the stored password. MAILBOX_SECRET here does not match the one the account was saved with — re-enter the app password to fix it."
    );
  }
}
