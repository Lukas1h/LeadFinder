import { Plus, FlaskConical } from "lucide-react";
import { db } from "@/db";
import { messagePresets, messagePresetVariants, messageSends, PRESET_TYPES, type PresetType } from "@/db/schema";
import { count } from "drizzle-orm";
import { ensureDefaultPresets } from "@/app/messageActions";
import { PresetCard, type VariantStats } from "./PresetCard";
import { PresetForm } from "./PresetForm";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<PresetType, string> = {
  initial_outreach: "Initial Outreach",
  follow_up: "Follow-up",
};

export default async function PresetsPage() {
  await ensureDefaultPresets();

  const [presets, variants, sendStats] = await Promise.all([
    db.select().from(messagePresets).orderBy(messagePresets.createdAt),
    db.select().from(messagePresetVariants).orderBy(messagePresetVariants.createdAt),
    db
      .select({ variantId: messageSends.variantId, outcome: messageSends.outcome, count: count() })
      .from(messageSends)
      .groupBy(messageSends.variantId, messageSends.outcome),
  ]);

  const statsByVariant: Record<string, VariantStats> = {};
  for (const row of sendStats) {
    const stats = statsByVariant[row.variantId] ?? { sent: 0, responded: 0, declined: 0 };
    stats.sent += row.count;
    if (row.outcome === "responded") stats.responded += row.count;
    if (row.outcome === "declined") stats.declined += row.count;
    statsByVariant[row.variantId] = stats;
  }

  const variantsByPreset: Record<string, typeof variants> = {};
  for (const v of variants) {
    (variantsByPreset[v.presetId] ??= []).push(v);
  }

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Message Presets</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A/B test your outreach copy — every send is logged against its variant, and marking a
            lead replied or declined credits that outcome back to it.
          </p>
        </div>
        <PresetForm
          trigger={
            <Button>
              <Plus />
              New preset
            </Button>
          }
        />
      </header>

      {presets.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <FlaskConical className="size-8" />
          <p>No presets yet — add one to start A/B testing your outreach.</p>
        </div>
      ) : (
        PRESET_TYPES.map((type) => {
          const typePresets = presets.filter((p) => p.type === type);
          if (typePresets.length === 0) return null;
          return (
            <section key={type} className="mb-8">
              <h2 className="text-sm font-medium text-muted-foreground mb-3">{TYPE_LABELS[type]}</h2>
              <div className="flex flex-col gap-4">
                {typePresets.map((preset) => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    variants={variantsByPreset[preset.id] ?? []}
                    statsByVariant={statsByVariant}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
    </main>
  );
}
