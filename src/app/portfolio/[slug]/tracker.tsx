"use client";

import { useEffect } from "react";

/** How often running totals are re-sent while the page is open, so a killed tab still leaves most of its visit behind. */
const FLUSH_EVERY_MS = 15_000;

/**
 * Records one visit to the agent page for Lukas's activity view
 * (/portfolio-links/[id]): seconds the tab is visible, how far down they
 * scroll, seconds each section (any element with data-section) sits in the
 * middle of the screen, and every tap on something marked data-track (with
 * data-track-detail saying which one). Reports to /api/portfolio/[slug]/track.
 */
export function PageTracker({ slug }: { slug: string }) {
  useEffect(() => {
    const url = `/api/portfolio/${slug}/track`;
    const session = crypto.randomUUID();
    const screenSize = `${window.screen.width}x${window.screen.height}`;
    const sections: Record<string, number> = {};
    const inView = new Set<string>();
    let activeSeconds = 0;
    let maxScroll = 0;
    let pending: { event: string; detail?: string }[] = [];
    let dirty = true;

    const payload = () => {
      const body = JSON.stringify({ session, screen: screenSize, activeSeconds, maxScroll, sections, events: pending });
      pending = [];
      dirty = false;
      return body;
    };
    // fetch with keepalive survives the page being left (the vCard download, the sms: link).
    const send = () => fetch(url, { method: "POST", body: payload(), keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {});
    const beacon = () => {
      if (!navigator.sendBeacon?.(url, new Blob([payload()], { type: "text/plain" }))) send();
    };

    const measureScroll = () => {
      const doc = document.documentElement;
      const pct = Math.round(((window.scrollY + window.innerHeight) / Math.max(1, doc.scrollHeight)) * 100);
      if (pct > maxScroll) {
        maxScroll = Math.min(100, pct);
        dirty = true;
      }
    };

    // "Seen" = crossing the middle tenth of the screen, which works the same for a short tile row and a tall photo grid.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const name = (e.target as HTMLElement).dataset.section;
          if (!name) continue;
          if (e.isIntersecting) inView.add(name);
          else inView.delete(name);
        }
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    document.querySelectorAll<HTMLElement>("[data-section]").forEach((el) => observer.observe(el));

    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      activeSeconds++;
      for (const name of inView) sections[name] = (sections[name] ?? 0) + 1;
      dirty = true;
    }, 1000);
    const flush = window.setInterval(() => dirty && document.visibilityState === "visible" && send(), FLUSH_EVERY_MS);

    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-track]");
      if (!el?.dataset.track) return;
      pending.push({ event: el.dataset.track, detail: el.dataset.trackDetail });
      send();
    };
    const onHide = () => document.visibilityState === "hidden" && beacon();

    measureScroll();
    send();
    window.addEventListener("scroll", measureScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", beacon);
    return () => {
      observer.disconnect();
      window.clearInterval(tick);
      window.clearInterval(flush);
      window.removeEventListener("scroll", measureScroll);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", beacon);
    };
  }, [slug]);

  return null;
}
