import { Plus, MapPinned } from "lucide-react";
import { db } from "@/db";
import { searchSources } from "@/db/schema";
import { desc } from "drizzle-orm";
import { fetchAccountUsage } from "@/lib/zillapi";
import { SourceCard } from "./SourceCard";
import { SourceForm } from "./SourceForm";
import { EmailSourceCard } from "./EmailSourceCard";
import { NotificationsCard } from "./NotificationsCard";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const inboxAddress = process.env.AGENTMAIL_INBOX_ADDRESS ?? null;
  // Independent of each other, so run them concurrently instead of paying
  // for a DB round trip followed by a separate Zillapi round trip.
  const [sources, usage] = await Promise.all([
    db.select().from(searchSources).orderBy(desc(searchSources.createdAt)),
    fetchAccountUsage(),
  ]);

  const totalCount = sources.length + (inboxAddress ? 1 : 0);

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>

        </div>
        <div className="flex items-center gap-3">
          {usage && (
            <div className="text-xs text-muted-foreground text-right leading-tight">
              <div className="font-medium text-foreground">
                {usage.creditsBalance.toLocaleString()} / {usage.creditsPerCycle.toLocaleString()}
              </div>
              <div>Zillapi credits left</div>
            </div>
          )}

        </div>
      </header>

      <NotificationsCard />

      <header className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <h2 className="text-xl font-semibold tracking-tight text-foreground -mb-2">Sources</h2>
        <div className="flex items-center gap-3">

          <SourceForm
            trigger={
              <Button>
                <Plus />
                Add source
              </Button>
            }
          />
        </div>
      </header>

      {totalCount === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <MapPinned className="size-8" />
          <p>No sources yet — add one to start finding leads.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {inboxAddress && <EmailSourceCard email={inboxAddress} />}
          {sources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      )}
    </main>
  );
}
