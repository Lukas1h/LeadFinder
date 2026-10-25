import { LUKAS_VCARD } from "@/lib/agentVcard";

/**
 * The agent page's "Save contact": a real file rather than a data: URL,
 * which iPhone Safari won't open. Served inline as text/vcard, Safari shows
 * its "Add to Contacts" card; desktop browsers download it. Under the page's
 * slug only so it lives on the same host and path family; the card is the same
 * for every page.
 */
export function GET() {
  return new Response(LUKAS_VCARD, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'inline; filename="Lukas Hahn Photographer.vcf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
