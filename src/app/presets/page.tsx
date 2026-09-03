import { Plus, FlaskConical } from "lucide-react";
import { db } from "@/db";
import { messagePresets, messagePresetVariants, PRESET_TYPES, type PresetType } from "@/db/schema";
import { ensureDefaultPresets } from "@/app/messageActions";
import { computeVariantStats } from "@/lib/messageStats";
import { PresetCard } from "./PresetCard";
import { PresetForm } from "./PresetForm";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<PresetType, string> = {
  initial_outreach: "Initial Outreach",
  follow_up: "Follow-up",
};

export default async function PresetsPage() {
  await ensureDefaultPresets();

  const [presets, variants, statsByVariant] = await Promise.all([
    db.select().from(messagePresets).orderBy(messagePresets.createdAt),
    db.select().from(messagePresetVariants).orderBy(messagePresetVariants.createdAt),
    computeVariantStats(),
  ]);

  const variantsByPreset: Record<string, typeof variants> = {};
  for (const v of variants) {
    (variantsByPreset[v.presetId] ??= []).push(v);
  }

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Message Presets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A/B test your outreach copy — add as many presets as you want per phase (one per angle,
          e.g. &ldquo;Bad Photos Pitch&rdquo;, &ldquo;Coming Soon&rdquo;), each with a few variants.
          Every send is logged, and marking a lead replied/quoted/booked/declined credits that
          outcome back to the exact variant that was sent.
        </p>
      </header>

      {presets.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <FlaskConical className="size-8" />
          <p>No presets yet — add one below to start A/B testing your outreach.</p>
        </div>
      )}

      {PRESET_TYPES.map((type) => {
        const typePresets = presets.filter((p) => p.type === type);
        return (
          <section key={type} className="mb-8">
            <div className="flex items-center justify-between gap-4 mb-3">
              <h2 className="text-sm font-medium text-muted-foreground">{TYPE_LABELS[type]}</h2>
              <PresetForm
                defaultType={type}
                trigger={
                  <Button variant="outline" size="sm">
                    <Plus />
                    Add preset
                  </Button>
                }
              />
            </div>

            {typePresets.length === 0 ? (
              <p className="text-sm text-muted-foreground/70">No presets for this phase yet.</p>
            ) : (
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
            )}
          </section>
        );
      })}
    </main>
  );
}
