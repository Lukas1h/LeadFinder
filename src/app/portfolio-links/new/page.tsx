import { PortfolioLinkBuilder } from "./PortfolioLinkBuilder";

export default function NewPortfolioLinkPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">New portfolio link</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Pick the area, video and lead photo for one agent. Photos, listings and pricing are the same on every page.
      </p>
      <PortfolioLinkBuilder />
    </main>
  );
}
