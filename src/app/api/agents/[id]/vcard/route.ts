import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";

// Escapes the characters vCard's TEXT value type reserves — comma,
// semicolon, backslash, newline — per RFC 6350 §3.4.
function escapeVCardValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

// Plain <a href> (not a download link) to this route, opened straight from
// the Agent detail dialog — Mobile Safari recognizes text/vcard and shows
// its native "Add Contact" sheet instead of just downloading the file.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const name = agent.name?.trim() || "Unknown Agent";
  const words = name.split(/\s+/);
  const familyName = words.length > 1 ? words[words.length - 1] : "";
  const givenName = words.length > 1 ? words.slice(0, -1).join(" ") : words[0];

  const vcard = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVCardValue(name)}`,
    `N:${escapeVCardValue(familyName)};${escapeVCardValue(givenName)};;;`,
    `TEL;TYPE=CELL:${agent.phone}`,
    "END:VCARD",
    "",
  ].join("\r\n");

  return new NextResponse(vcard, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `inline; filename="${name.replace(/[^a-zA-Z0-9]+/g, "-")}.vcf"`,
    },
  });
}
