import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getPortfolioPrefill } from "../actions";
import { PortfolioLinkBuilder } from "./PortfolioLinkBuilder";

export default function NewPortfolioLinkPage({ searchParams }: { searchParams: Promise<{ agent?: string; before?: string; after?: string }> }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">New portfolio link</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Pick an agent and their details, nearby jobs and area fill in. Everything stays editable.
      </p>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <BuilderContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

// ?agent=<id> comes from the "Create portfolio" button on an agent's profile.
async function BuilderContent({ searchParams }: { searchParams: Promise<{ agent?: string; before?: string; after?: string }> }) {
  const { agent, before, after } = await searchParams;
  const initial = agent && UUID_RE.test(agent) ? await getPortfolioPrefill(agent) : null;
  // ?before=&after= are portfolio_images ids, from the photo editor's "Use on agent page".
  const image = (id: string | undefined) => (id && UUID_RE.test(id) ? `/api/portfolio-image/${id}` : null);
  return (
    <PortfolioLinkBuilder
      key={[initial?.agent.id, before, after].join("|")}
      initial={initial}
      initialBefore={image(before)}
      initialAfter={image(after)}
    />
  );
}
