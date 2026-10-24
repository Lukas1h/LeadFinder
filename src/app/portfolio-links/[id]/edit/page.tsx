import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getPortfolioLinkForEdit } from "../../actions";
import { PortfolioLinkBuilder } from "../../new/PortfolioLinkBuilder";

/** Change an existing agent page in place: same URL, and its activity stays with it. */
export default function EditPortfolioLinkPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <EditContent params={params} />
      </Suspense>
    </main>
  );
}

async function EditContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const link = /^[0-9a-f-]{36}$/i.test(id) ? await getPortfolioLinkForEdit(id) : null;
  if (!link) notFound();
  return (
    <>
      <Link href={`/portfolio-links/${link.linkId}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Activity
      </Link>
      <h1 className="mb-1 text-2xl font-semibold">Edit portfolio link</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        <a href={`${link.url}?preview=1`} target="_blank" rel="noopener noreferrer" className="underline">
          {link.url}
        </a>{" "}
        keeps its address; changes show the next time it&apos;s opened.
      </p>
      <PortfolioLinkBuilder start={{ linkId: link.linkId, agent: link.agent, content: link.content }} />
    </>
  );
}
