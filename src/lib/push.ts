import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are not set");
  }
  webpush.setVapidDetails("mailto:lukas1h07@gmail.com", publicKey, privateKey);
  configured = true;
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Notifies every subscribed device (the iOS PWA install, any desktop
 * browser subscription, etc) that new leads showed up — called from
 * insertAndEnrichListings so both the bbox sync and the AgentMail webhook
 * path trigger it the same way. A subscription that comes back 404/410
 * (uninstalled PWA, revoked permission) is deleted rather than retried —
 * it will never succeed again.
 */
export async function notifyNewListings(count: number): Promise<void> {
  if (count === 0) return;
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;

  ensureConfigured();

  const subs = await db.select().from(pushSubscriptions);
  if (subs.length === 0) return;

  const payload: PushPayload = {
    title: count === 1 ? "1 new lead" : `${count} new leads`,
    body: "New listings just came in on LeadFinder.",
    url: "/",
  };

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        } else {
          console.error("push send failed", sub.endpoint, err);
        }
      }
    })
  );
}
