import { Plus, MapPinned } from "lucide-react";
import { db } from "@/db";
import { searchSources } from "@/db/schema";
import { desc } from "drizzle-orm";
import { SourceCard } from "./SourceCard";
import { SourceForm } from "./SourceForm";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const sources = await db.select().from(searchSources).orderBy(desc(searchSources.createdAt));

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {sources.length} search source{sources.length === 1 ? "" : "s"} — each is fetched on
            every sync
          </p>
        </div>
        <SourceForm
          trigger={
            <Button>
              <Plus />
              Add source
            </Button>
          }
        />
      </header>

      {sources.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <MapPinned className="size-8" />
          <p>No search sources yet — add one to start finding leads.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {sources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      )}
    </main>
  );
}
