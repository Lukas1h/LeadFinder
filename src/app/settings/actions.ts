"use server";

import { db } from "@/db";
import { searchSources, appSettings, emailAccounts } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { encryptSecret } from "@/lib/secretBox";
import { getMailboxById, setDefaultAccount, testMailboxConnection } from "@/lib/emailAccounts";
import type { Mailbox } from "@/lib/emailAccounts";

export interface SourceInput {
  name: string;
  bbox: string;
  priceMin: number | null;
  priceMax: number | null;
  homeTypes: string | null;
  comingSoonOnly: boolean;
  keywords: string | null;
}

function validateBbox(bbox: string): string | null {
  const parts = bbox.split(",").map((p) => p.trim());
  if (parts.length !== 4 || parts.some((p) => p === "" || Number.isNaN(Number(p)))) {
    return "Bbox must be four comma-separated numbers: west,south,east,north";
  }
  return null;
}

export async function createSource(input: SourceInput) {
  const error = validateBbox(input.bbox);
  if (error) return { error };

  await db.insert(searchSources).values({
    name: input.name,
    bbox: input.bbox,
    priceMin: input.priceMin,
    priceMax: input.priceMax,
    homeTypes: input.homeTypes,
    comingSoonOnly: input.comingSoonOnly,
    keywords: input.keywords,
  });

  revalidatePath("/settings");
  return { error: null };
}

export async function updateSource(id: string, input: SourceInput) {
  const error = validateBbox(input.bbox);
  if (error) return { error };

  await db
    .update(searchSources)
    .set({
      name: input.name,
      bbox: input.bbox,
      priceMin: input.priceMin,
      priceMax: input.priceMax,
      homeTypes: input.homeTypes,
      comingSoonOnly: input.comingSoonOnly,
      keywords: input.keywords,
    })
    .where(eq(searchSources.id, id));

  revalidatePath("/settings");
  return { error: null };
}

export async function deleteSource(id: string) {
  await db.delete(searchSources).where(eq(searchSources.id, id));
  revalidatePath("/settings");
}

export async function toggleSource(id: string, enabled: boolean) {
  await db.update(searchSources).set({ enabled }).where(eq(searchSources.id, id));
  revalidatePath("/settings");
}

export async function updateFollowUpAfterDays(days: number) {
  if (!Number.isInteger(days) || days < 1) {
    return { error: "Must be a whole number of at least 1" };
  }

  await db
    .insert(appSettings)
    .values({ id: "singleton", followUpAfterDays: days })
    .onConflictDoUpdate({ target: appSettings.id, set: { followUpAfterDays: days } });

  revalidatePath("/settings");
  revalidatePath("/pipeline");
  return { error: null };
}

// ─── Sending email accounts ───
//
// The From address for every outbound email, switchable from Settings without
// a redeploy. See src/lib/emailAccounts.ts for how the active one is picked
// and src/lib/mailer.ts for the send itself.
//
// Passwords go in encrypted (src/lib/secretBox.ts) and are never returned to
// the client — the settings page reads rows through listMailboxes(), which
// leaves passwordEnc as ciphertext, so there is no path that puts a plaintext
// app password into a Server Action response or the RSC payload.

export interface EmailAccountInput {
  provider: string;
  label: string;
  email: string;
  /** Display name for the From header, e.g. "Lukas Hahn". */
  fromName: string;
  /** An app password. Empty on edit means "keep the stored one". */
  password: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapUser: string;
}

/**
 * Enough to catch a pasted-in app password or a typo'd host before it becomes
 * a failed send. Deliberately permissive about the address itself: a From
 * header only has to look like one, and Gmail aliases mean it needn't match
 * anything in particular.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateAccount(input: EmailAccountInput, requirePassword: boolean): string | null {
  if (!input.label.trim()) return "Give the account a name";
  if (!EMAIL_RE.test(input.email.trim())) return "Enter a valid email address";
  if (requirePassword && !input.password.trim()) return "Enter the app password";
  if (!input.smtpHost.trim()) return "Enter the SMTP server";
  if (!Number.isInteger(input.smtpPort) || input.smtpPort < 1 || input.smtpPort > 65535) {
    return "SMTP port must be a number between 1 and 65535";
  }
  if (input.imapHost.trim() && (!Number.isInteger(input.imapPort) || input.imapPort < 1 || input.imapPort > 65535)) {
    return "IMAP port must be a number between 1 and 65535";
  }
  return null;
}

function accountValues(input: EmailAccountInput) {
  const email = input.email.trim().toLowerCase();
  return {
    label: input.label.trim(),
    email,
    // Blank means "bare address", which is a legitimate choice — some people
    // deliberately send without a display name — so this is stored as null
    // rather than rejected.
    fromName: input.fromName.trim() || null,
    smtpHost: input.smtpHost.trim(),
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure,
    imapHost: input.imapHost.trim() || null,
    imapPort: input.imapHost.trim() ? input.imapPort : null,
    // Blank means "same address", which every provider this app supports
    // allows; storing null keeps the row honest instead of duplicating email.
    imapUser: input.imapUser.trim() || null,
  };
}

export async function createEmailAccount(input: EmailAccountInput) {
  const error = validateAccount(input, true);
  if (error) return { error };

  // The first account added becomes the sender, so the app is never left with
  // rows but nothing marked active (getSendingMailbox would still fall back,
  // but silently picking one under the user is worse than saying so here).
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(emailAccounts);

  await db.insert(emailAccounts).values({
    ...accountValues(input),
    passwordEnc: encryptSecret(input.password.trim()),
    isDefault: count === 0,
  });

  revalidatePath("/settings");
  return { error: null };
}

export async function updateEmailAccount(id: string, input: EmailAccountInput) {
  const error = validateAccount(input, false);
  if (error) return { error };

  const values = accountValues(input);
  await db
    .update(emailAccounts)
    .set({
      ...values,
      // Only overwrite the credential when a new one was actually typed —
      // an empty field on the edit form means "unchanged", otherwise every
      // rename would silently wipe the password.
      ...(input.password.trim() ? { passwordEnc: encryptSecret(input.password.trim()) } : {}),
      // Re-test: the thing that usually changed is the password or host.
      lastTestedAt: null,
      lastTestError: null,
    })
    .where(eq(emailAccounts.id, id));

  revalidatePath("/settings");
  return { error: null };
}

export async function deleteEmailAccount(id: string) {
  await db.delete(emailAccounts).where(eq(emailAccounts.id, id));
  revalidatePath("/settings");
  return { error: null };
}

export async function makeDefaultEmailAccount(id: string) {
  await setDefaultAccount(id);
  revalidatePath("/settings");
  return { error: null };
}

/**
 * Authenticates against the account's SMTP server and records the outcome on
 * the row so the settings list can show it. verify() opens a connection and
 * logs in — it sends nothing, so this can't reach an agent.
 */
export async function testEmailAccount(id: string) {
  let mailbox: Mailbox | null = null;
  try {
    mailbox = await getMailboxById(id);
  } catch (err) {
    // Almost always a rotated MAILBOX_SECRET: the row is fine, the key isn't.
    const error = err instanceof Error ? err.message : String(err);
    await db
      .update(emailAccounts)
      .set({ lastTestedAt: new Date(), lastTestError: `Could not decrypt the stored password (${error})` })
      .where(eq(emailAccounts.id, id));
    revalidatePath("/settings");
    return { error };
  }
  if (!mailbox) return { error: "That account no longer exists" };

  const { error } = await testMailboxConnection(mailbox);
  await db
    .update(emailAccounts)
    .set({ lastTestedAt: new Date(), lastTestError: error })
    .where(eq(emailAccounts.id, id));

  revalidatePath("/settings");
  return { error };
}
