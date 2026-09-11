import nodemailer from "nodemailer";

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
  await getTransporter().sendMail({
    from,
    to: input.toName ? `"${input.toName.replace(/"/g, "")}" <${input.to}>` : input.to,
    subject: input.subject,
    text: input.text,
    // nodemailer fetches each by href itself — no need to download the
    // bytes into this function first.
    attachments: input.attachments?.map((a) => ({ filename: a.filename, href: a.url })),
  });
}
