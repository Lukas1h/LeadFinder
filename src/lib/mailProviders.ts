/**
 * Known mail providers and their SMTP/IMAP servers, so nobody has to know
 * that Gmail's SMTP host is smtp.gmail.com.
 *
 * Split out from lib/emailAccounts.ts on purpose: that module opens the
 * database and imports nodemailer, so a client component importing it would
 * drag server-only code into the browser bundle. This one is pure data and is
 * safe on both sides — the settings form imports it directly rather than
 * keeping a hand-maintained copy that could drift.
 *
 * Ports and TLS are the documented ones. Gmail and iCloud both accept
 * 587 + STARTTLS, which is what the app has always used for iCloud.
 */
export const MAIL_PROVIDERS = [
  {
    id: "gmail",
    label: "Gmail",
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    // Google rejects the real account password here; an app password is
    // required, and creating one requires 2-Step Verification to already be on.
    help: "Use a Google app password (16 characters, spaces ignored) — not your normal Google password. Requires 2-Step Verification to be on.",
  },
  {
    id: "icloud",
    label: "iCloud",
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    help: "Use an Apple app-specific password from appleid.apple.com (Sign-In and Security > App-Specific Passwords), not your Apple ID password.",
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "outlook.office365.com",
    imapPort: 993,
    help: "Use the account's own password. Microsoft may require an app password if the account has two-factor authentication on.",
  },
  {
    id: "custom",
    label: "Other (enter server manually)",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "",
    imapPort: 993,
    help: null,
  },
] as const;

export type MailProviderId = (typeof MAIL_PROVIDERS)[number]["id"];

export function providerById(id: string) {
  return MAIL_PROVIDERS.find((p) => p.id === id);
}
