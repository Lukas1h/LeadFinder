import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { ImapFlow } from "imapflow";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { UnsubscribedError } from "@/lib/unsubscribe";
import { contentTypeFor } from "@/lib/attachments";
import { PHOTOS_MARKER } from "@/lib/messageTemplate";

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
  // Base64 content, straight off the preset row (see
  // messagePresets.attachments) — never a URL to fetch, so a send never
  // makes a network call for its attachment(s), whether it's one send or
  // a bulk batch of 40.
  attachments?: { filename: string; content: string }[];
  // Photos to show in the body, where the text says {{photos}} (or at the end
  // when it doesn't). Giving any makes this the one kind of email that isn't
  // plain text: see lib/emailPhotos.ts for which emails get them and why.
  inlinePhotos?: { filename: string; content: string; contentType?: string }[];
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The text with the photos marker taken out, for the plain part and for every email without photos. */
function withoutPhotosMarker(text: string): string {
  return text.includes(PHOTOS_MARKER) ? text.replace(/\n*\{\{photos\}\}\n*/g, "\n\n").trim() : text;
}

/**
 * The same words as the plain text, with the photos in place. No fonts,
 * colours or layout, so it still looks like an email someone typed: the mail
 * app's own text style, line breaks where he put them, links clickable.
 */
export function htmlWithPhotos(text: string, cids: string[]): string {
  const words = (part: string) =>
    escapeHtml(part.trim())
      .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`)
      .replace(/\n/g, "<br>\n");
  const photos = cids
    .map(
      (cid, i) =>
        `<img src="cid:${cid}" alt="Photo ${i + 1}" width="560" style="display:block;max-width:100%;height:auto;border:0;margin:0 0 12px 0">`
    )
    .join("\n");
  const [before, ...rest] = text.split(PHOTOS_MARKER);
  const after = rest.join("");
  const parts = [words(before), photos, after.trim() ? words(after) : ""].filter(Boolean);
  return `<div dir="ltr">${parts.join("<br><br>\n")}</div>`;
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
  // ImapFlow is an EventEmitter — an 'error' event (e.g. a flaky timeout)
  // with no listener crashes the whole process, not just this function.
  client.on("error", (err) => console.error("appendToSentFolder: ImapFlow error event", err));

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
 *
 * Also the single enforcement point for List-Unsubscribes. Every outbound
 * email in the app funnels through here — MCP tools, the Compose page, the
 * cold-outreach cron — so checking in one place means a new send path can't be
 * added later that quietly ignores opt-outs. Throws UnsubscribedError rather
 * than returning quietly, because every caller writes a messageSends row after
 * this resolves, and a silent skip would record a send that never happened and
 * inflate that variant's numbers.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (process.env.USE_MOCK_SMTP === "true") {
    console.log("sendEmail: USE_MOCK_SMTP=true, not sending", input);
    return;
  }

  const recipient = input.to.trim().toLowerCase();
  const [optedOut] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(sql`lower(trim(${agents.email}))`, recipient), isNotNull(agents.emailUnsubscribedAt)))
    .limit(1);
  if (optedOut) throw new UnsubscribedError(input.to);

  const from = process.env.ICLOUD_EMAIL;
  const photos = (input.inlinePhotos ?? []).map((p, i) => ({ ...p, cid: `photo${i + 1}.${crypto.randomUUID()}@hahnmedia` }));
  const mailOptions = {
    from,
    to: input.toName ? `"${input.toName.replace(/"/g, "")}" <${input.to}>` : input.to,
    subject: input.subject,
    text: withoutPhotosMarker(input.text),
    ...(photos.length > 0 ? { html: htmlWithPhotos(input.text, photos.map((p) => p.cid)) } : {}),
    attachments: [
      ...(input.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content, encoding: "base64" as const })),
      ...photos.map((p) => ({
        filename: p.filename,
        content: p.content,
        encoding: "base64" as const,
        cid: p.cid,
        contentType: p.contentType || contentTypeFor(p.filename),
        contentDisposition: "inline" as const,
      })),
    ],
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
