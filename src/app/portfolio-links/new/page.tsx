import { PortfolioLinkBuilder } from "./PortfolioLinkBuilder";

export default function NewPortfolioLinkPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">New portfolio link</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Pick the best photos, a video, and a few named houses. Nothing on the page itself says who it's for.
      </p>
      <PortfolioLinkBuilder />
    </main>
  );
}
