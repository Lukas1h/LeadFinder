import { desc, eq, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "@/db";
import { emailAccounts } from "@/db/schema";
import { decryptSecret } from "@/lib/secretBox";

// Re-exported so callers get the presets from one place; the definitions
// live in the client-safe module (this one opens the DB and imports
// nodemailer, which a client component must not pull into its bundle).
export { MAIL_PROVIDERS, providerById } from "@/lib/mailProviders";
export type { MailProviderId } from "@/lib/mailProviders";

/**
 * The sending accounts in email_accounts, and which one outbound mail goes
 * from. Read by src/lib/mailer.ts on every send — this module is the only
 * thing that decides which mailbox a message leaves from, so switching
 * senders in Settings is a one-row update and needs no redeploy.
 *
 * The env vars are deliberately still honoured: with no rows in the table the
 * old ICLOUD_EMAIL/ICLOUD_APP_PASSWORD pair is used, so an environment that
 * has never opened Settings keeps sending exactly as it did before.
 */

/** An account with its password decrypted, ready to hand to nodemailer. */
export interface Mailbox {
  /** Stable key for transporter caching. Env fallback uses a fixed sentinel. */
  key: string;
  label: string;
  email: string;
  /** Display name for the From header, or null for the bare address. */
  fromName: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  password: string;
  /** Null when the account has no IMAP configured — skip the Sent copy. */
  imap: { host: string; port: number; user: string } | null;
  /** False for the env-var fallback, so the UI can say it's read-only. */
  editable: boolean;
}


function toMailbox(row: typeof emailAccounts.$inferSelect, password: string): Mailbox {
  return {
    key: row.id,
    label: row.label,
    email: row.email,
    fromName: row.fromName,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    password,
    imap: row.imapHost
      ? { host: row.imapHost, port: row.imapPort ?? 993, user: row.imapUser ?? row.email }
      : null,
    editable: true,
  };
}

/**
 * Every configured account, default first then newest. The password is left
 * encrypted — callers that need it go through getSendingMailbox().
 */
export async function listMailboxes(): Promise<(typeof emailAccounts.$inferSelect)[]> {
  return db
    .select()
    .from(emailAccounts)
    .orderBy(desc(emailAccounts.isDefault), desc(emailAccounts.createdAt));
}

/**
 * The mailbox outbound email should go from right now: the default row, or
 * the oldest row if somehow none is flagged (so a misclick can never leave the
 * app with no sender), or the env-var iCloud pair when the table is empty.
 *
 * Throws rather than sending from the wrong place when it can't tell — a send
 * from an unconfigured sender is worse than a failed send, because it reaches
 * a real agent from an address Lukas may not be able to reply from.
 */
export async function getSendingMailbox(): Promise<Mailbox> {
  const [preferred, oldest] = await Promise.all([
    db.select().from(emailAccounts).where(eq(emailAccounts.isDefault, true)).limit(1),
    db.select().from(emailAccounts).orderBy(emailAccounts.createdAt).limit(1),
  ]);

  const row = preferred[0] ?? oldest[0];

  if (!row) {
    const user = process.env.ICLOUD_EMAIL;
    const pass = process.env.ICLOUD_APP_PASSWORD;
    if (!user || !pass) {
      throw new Error(
        "No sending account is configured. Add one in Settings, or set ICLOUD_EMAIL / ICLOUD_APP_PASSWORD."
      );
    }
    return {
      key: "env-icloud",
      label: "iCloud (from environment)",
      email: user,
      // No name column exists for the env fallback, so derive the obvious one
      // from the local part of the address rather than showing a bare address
      // if this fallback is ever the sender again.
      fromName: user.slice(0, user.indexOf("@")),
      smtpHost: "smtp.mail.me.com",
      smtpPort: 587,
      smtpSecure: false,
      password: pass,
      imap: { host: "imap.mail.me.com", port: 993, user },
      editable: false,
    };
  }

  return toMailbox(row, decryptSecret(row.passwordEnc));
}

/** Same as getSendingMailbox but for a specific row — the settings test button. */
export async function getMailboxById(id: string): Promise<Mailbox | null> {
  const [row] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, id)).limit(1);
  if (!row) return null;
  return toMailbox(row, decryptSecret(row.passwordEnc));
}

/**
 * Authenticates against the account's SMTP server without sending anything.
 * Used by the Settings page's test button: a wrong app password, a
 * deactivated account, or Google blocking a non-app password all fail here
 * with a readable message instead of at the next real send, where the failure
 * lands on an outreach email to an agent.
 *
 * Errors are returned rather than thrown — the caller shows the text and
 * records it against the row.
 */
export async function testMailboxConnection(mailbox: Mailbox): Promise<{ error: string | null }> {
  try {
    const transporter = nodemailer.createTransport({
      host: mailbox.smtpHost,
      port: mailbox.smtpPort,
      secure: mailbox.smtpSecure,
      ...(mailbox.smtpSecure ? {} : { requireTLS: true }),
      auth: { user: mailbox.email, pass: mailbox.password },
    });
    await transporter.verify();
    // A verifier built here isn't the cached one; don't let it take the slot.
    transporter.close();
    return { error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

/**
 * Makes one account the sender and clears the flag everywhere else, in a
 * single statement: a conditional SET rather than two updates, so two accounts
 * can never both believe they're the sender even for the length of one
 * request. (db.transaction isn't an option — the app talks to Neon over
 * neon-http, which has no interactive transactions.)
 */
export async function setDefaultAccount(id: string): Promise<void> {
  await db
    .update(emailAccounts)
    .set({ isDefault: sql`id = ${id}` });
}
