import { Suspense } from "react";
import { Plus, FlaskConical } from "lucide-react";
import { db } from "@/db";
import { messagePresets, messagePresetVariants, PRESET_TYPES, type PresetType, type MessageChannel } from "@/db/schema";
import { ensureDefaultPresets, ensureAiDraftPresets } from "@/app/messageActions";
import { ensureDefaultEmailPreset } from "@/app/composeEmailActions";
import { computeVariantStats, getRecentMessageSends } from "@/lib/messageStats";
import { PresetCard } from "./PresetCard";
import { PresetForm } from "./PresetForm";
import { ComposeEmailPanel } from "./ComposeEmailPanel";
import { RecentSendsCard } from "./RecentSendsCard";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PresetsSkeleton } from "./loading";

const TYPE_LABELS: Record<PresetType, string> = {
  initial_outreach: "Initial Outreach",
  follow_up: "Follow-up",
};

export default function MessagingPage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<PresetsSkeleton />}>
        <MessagingContent />
      </Suspense>
    </main>
  );
}

async function MessagingContent() {
  // Deliberately NOT "use cache" — see the comment in src/app/pipeline/page.tsx.

  await ensureDefaultPresets();
  await Promise.all(PRESET_TYPES.map((type) => ensureAiDraftPresets(type)));
  await ensureDefaultEmailPreset();

  const [presets, variants, statsByVariant, recentSends] = await Promise.all([
    db.select().from(messagePresets).orderBy(messagePresets.createdAt),
    db.select().from(messagePresetVariants).orderBy(messagePresetVariants.createdAt),
    computeVariantStats(),
    getRecentMessageSends(),
  ]);

  const variantsByPreset: Record<string, typeof variants> = {};
  for (const v of variants) {
    (variantsByPreset[v.presetId] ??= []).push(v);
  }

  const smsPresets = presets.filter((p) => p.channel === "sms");
  const emailPresets = presets.filter((p) => p.channel === "email");

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Messaging</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compose a cold email to any realtor, and manage the SMS/email templates the app sends
          from — both share the same A/B rotation and stats.
        </p>
      </header>

      <section className="mb-6">
        <ComposeEmailPanel />
      </section>

      <RecentSendsCard sends={recentSends} />

      <Separator className="mb-8" />

      <TemplateSection
        title="SMS Templates"
        channel="sms"
        presets={smsPresets}
        variantsByPreset={variantsByPreset}
        statsByVariant={statsByVariant}
      />

      <Separator className="my-8" />

      <TemplateSection
        title="Email Templates"
        channel="email"
        presets={emailPresets}
        variantsByPreset={variantsByPreset}
        statsByVariant={statsByVariant}
      />
    </>
  );
}

function TemplateSection({
  title,
  channel,
  presets,
  variantsByPreset,
  statsByVariant,
}: {
  title: string;
  channel: MessageChannel;
  presets: (typeof messagePresets.$inferSelect)[];
  variantsByPreset: Record<string, (typeof messagePresetVariants.$inferSelect)[]>;
  statsByVariant: Awaited<ReturnType<typeof computeVariantStats>>;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground mb-1">{title}</h2>

      {presets.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-10 text-muted-foreground">
          <FlaskConical className="size-8" />
          <p>No {title.toLowerCase()} yet — add one below to start A/B testing your outreach.</p>
        </div>
      )}

      {PRESET_TYPES.map((type) => {
        const typePresets = presets.filter((p) => p.type === type);
        return (
          <section key={type} className="mb-8">
            <div className="flex items-center justify-between gap-4 mb-3">
              <h3 className="text-sm font-medium text-muted-foreground">{TYPE_LABELS[type]}</h3>
              <PresetForm
                defaultType={type}
                defaultChannel={channel}
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
    </div>
  );
}
