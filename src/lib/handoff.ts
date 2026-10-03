import { toast } from "sonner";

/**
 * Every hand-off to another app (Messages, the phone dialer) goes through
 * here: log first, then open. The app is frozen the moment the other app
 * opens on iOS, so a request fired after the navigation can be lost — which is
 * exactly how Queue-page texts went unlogged. Logging only ever records a
 * pending "did it send?" question (see startTextHandoff), so doing it first is
 * safe: nothing is committed until that's answered.
 */
export async function handOff(url: string, log: () => Promise<unknown>): Promise<void> {
  try {
    await log();
  } catch {
    toast.error("Couldn't log that — try again.");
    return;
  }
  window.location.href = url;
}
