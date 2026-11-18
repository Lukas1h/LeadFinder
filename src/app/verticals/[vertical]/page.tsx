import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getVertical, VERTICALS } from "@/lib/verticals";
import { listVerticalLinks } from "../data";
import { CreateLinkButton, LinkList } from "./client";

/** The verticals are a fixed list (lib/verticals.ts), so the param is known at build time. */
export function generateStaticParams() {
  return Object.keys(VERTICALS).map((vertical) => ({ vertical }));
}

/** One vertical's company pages: make one per company, text it by hand, see who opened it. */
export default async function VerticalLinksPage({ params }: { params: Promise<{ vertical: string }> }) {
  const { vertical } = await params;
  const v = getVertical(vertical);
  if (!v) notFound();
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{v.label}</h1>
        <CreateLinkButton vertical={v.key} />
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Links vertical={v.key} />
      </Suspense>
    </main>
  );
}

async function Links({ vertical }: { vertical: string }) {
  const links = await listVerticalLinks(vertical);
  return <LinkList links={links} />;
}
