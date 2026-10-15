/** A preset's Leads-page sections, stored comma-separated: "backup,video" → ["backup", "video"]. */
export function presetSections(leadSection: string | null): string[] {
  return (leadSection ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
