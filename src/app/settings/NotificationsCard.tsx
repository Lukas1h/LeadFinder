"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { savePushSubscription, deletePushSubscription } from "@/app/pushActions";

type Status = "unsupported" | "needs-install" | "denied" | "off" | "on" | "loading";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function NotificationsCard() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    async function detect() {
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      if (!isStandalone() && /iPad|iPhone|iPod/.test(navigator.userAgent)) {
        setStatus("needs-install");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      setStatus(existing ? "on" : "off");
    }

    void detect();
  }, []);

  const handleEnable = async () => {
    setStatus("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Push not configured");

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      await savePushSubscription(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
      setStatus("on");
      toast.success("Notifications enabled");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't enable notifications");
      setStatus("off");
    }
  };

  const handleDisable = async () => {
    setStatus("loading");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await deletePushSubscription(sub.endpoint);
      await sub.unsubscribe();
    }
    setStatus("off");
  };

  return (
    <Card className="p-4 mb-8 gap-3">
      <div className="flex items-center gap-2">
        <Bell className="size-4 text-muted-foreground" />
        <h2 className="font-semibold text-foreground text-sm">Notifications</h2>
      </div>

      {status === "loading" && <p className="text-sm text-muted-foreground">Checking…</p>}

      {status === "unsupported" && (
        <p className="text-sm text-muted-foreground">
          Push notifications aren&rsquo;t supported in this browser.
        </p>
      )}

      {status === "needs-install" && (
        <p className="text-sm text-muted-foreground">
          On iOS, add LeadFinder to your Home Screen first — Share <span className="font-mono">→</span>{" "}
          Add to Home Screen — then open it from there to turn on notifications.
        </p>
      )}

      {status === "denied" && (
        <p className="text-sm text-muted-foreground">
          Notifications are blocked for LeadFinder — enable them in your device settings to turn this
          on.
        </p>
      )}

      {status === "off" && (
        <>
          <p className="text-sm text-muted-foreground">
            Get notified on this device the moment a new lead comes in.
          </p>
          <Button onClick={handleEnable} className="self-start">
            <BellRing />
            Enable notifications
          </Button>
        </>
      )}

      {status === "on" && (
        <>
          <p className="text-sm text-muted-foreground">Notifications are on for this device.</p>
          <Button onClick={handleDisable} variant="outline" className="self-start">
            <BellOff />
            Turn off
          </Button>
        </>
      )}
    </Card>
  );
}
