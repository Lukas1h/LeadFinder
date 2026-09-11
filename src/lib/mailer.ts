import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { ImapFlow } from "imapflow";

let transporter: ReturnType<typeof nodemailer.createTransport> | undefined;

function getTransporter() {
  if (!transporter) {
    const user = process.env.ICLOUD_EMAIL;
    const pass = process.env.ICLOUD_APP_PASSWORD;
    if (!user || !pass) {
      throw new Error("ICLOUD_EMAIL / ICLOUD_APP_PASSWORD are not set");
    }
    // iCloud SMTP requires an app-specific password (appleid.apple.com ->
    // Sign-In and Security -> App-Specific Passwords), not the main Apple ID
    // password, and requires From == the authenticated address.
    transporter = nodemailer.createTransport({
      host: "smtp.mail.me.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user, pass },
    });
  }
  return transporter;
}

export interface SendEmailInput {
  to: string;
  toName: string | null;
  subject: string;
  text: string;
  attachments?: { filename: string; url: string }[];
}

/**
 * Appends the just-sent message to iCloud's Sent folder over IMAP — SMTP
 * only transmits, it never touches the mailbox, so without this a message
 * sent through this app (unlike one sent from Mail.app itself) would never
 * show up in Sent anywhere: not Mail.app, not iCloud.com, not on other
 * devices. Best-effort: the send already succeeded by the time this runs,
 * so a failure here is logged, not thrown — the email got delivered either
 * way, this is purely about it also being visible locally.
 */
async function appendToSentFolder(raw: Buffer): Promise<void> {
  const user = process.env.ICLOUD_EMAIL;
  const pass = process.env.ICLOUD_APP_PASSWORD;
  if (!user || !pass) return;

  const client = new ImapFlow({
    host: "imap.mail.me.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    const mailboxes = await client.list();
    // Found by the IMAP SPECIAL-USE flag rather than a hardcoded folder
    // name ("Sent Messages" vs "Sent" etc. isn't documented anywhere
    // reliable) — falls back to a name match if the server doesn't
    // advertise SPECIAL-USE for some reason.
    const sentBox =
      mailboxes.find((mb) => mb.specialUse === "\\Sent") ?? mailboxes.find((mb) => /^sent/i.test(mb.name));
    if (!sentBox) {
      console.error("appendToSentFolder: no Sent mailbox found", mailboxes.map((m) => m.path));
      return;
    }
    await client.append(sentBox.path, raw, ["\\Seen"]);
  } catch (err) {
    console.error("appendToSentFolder: failed", err);
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Sends via iCloud SMTP. Throws on any failure — callers must not write a
 * messageSends row or touch the agents table unless this resolves, since
 * (unlike an sms: deep link) this is a real network call that can fail.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (process.env.USE_MOCK_SMTP === "true") {
    console.log("sendEmail: USE_MOCK_SMTP=true, not sending", input);
    return;
  }

  const from = process.env.ICLOUD_EMAIL;
  const mailOptions = {
    from,
    to: input.toName ? `"${input.toName.replace(/"/g, "")}" <${input.to}>` : input.to,
    subject: input.subject,
    text: input.text,
    // nodemailer fetches each by href itself — no need to download the
    // bytes into this function first.
    attachments: input.attachments?.map((a) => ({ filename: a.filename, href: a.url })),
  };

  await getTransporter().sendMail(mailOptions);

  // Best-effort, after the real send succeeds — see appendToSentFolder's
  // own comment for why this is needed at all.
  try {
    const raw = await new MailComposer(mailOptions).compile().build();
    await appendToSentFolder(raw);
  } catch (err) {
    console.error("sendEmail: building/appending Sent copy failed", err);
  }
}
