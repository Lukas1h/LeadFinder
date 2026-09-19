import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/gemini";

// Temporary, one-off route to generate the "High-End Video & Photo" email
// preset's copy via Gemini (Lukas asked for Gemini's writing specifically,
// not a hand-written template) — removed once the content is generated
// and reviewed. Same bearer-secret gate as /api/mcp since this also isn't
// a public read endpoint.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.MCP_SHARE_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const PROMPT = `You are writing a cold outreach EMAIL (not a text message) from Lukas Hahn, a local real estate photographer/videographer, to real estate agents who list high-end, expensive, architecturally interesting properties. This email specifically pitches VIDEO as the lead service — luxury listings are the exact segment where a walkthrough/cinematic video makes the biggest difference — with photography offered as a secondary, complementary service, not the headline.

For reference, here is Lukas's existing "backup photographer" cold email (a different, more general template, already in use) — match its plain, human, not-salesy voice and structure, but do NOT reuse its "backup/not replacing your photographer" angle. This new one should read as a specialist pitch for a specific kind of listing, not a generic backup offer:

---
Subject: Backup real estate photographer

Hi {{firstName}},

I'm Lukas. I'm a local real estate photographer.

I'm sure you already have a photographer you normally use, so I'm not looking to replace them. I'd just like to be a reliable backup when you need someone last minute, your usual photographer is booked, or you need a quick turnaround.

I offer 24-hour delivery, free reshoots, flexible scheduling, and photo + drone + video. My goal is simply to make the media side of your listings easy.

I've attached my pricing and a few examples of my work.

Give me a call if there's anything I can help you out with!

Thanks for your time!


Lukas Hahn
Hahn Media
https://www.lukashahn.art/real-estate
(541) 430-3372
---

Requirements for the new email:
- Subject line: short, specific to video/high-end listings, not generic.
- Use {{firstName}} for the agent's name, and use {{street}} naturally somewhere as an optional property reference (e.g. "I saw your listing on {{street}}") — it should read naturally whether or not that placeholder gets filled in with a real address.
- Open by acknowledging the property looks like the kind of listing that deserves more than standard photos — video (cinematic walkthrough, aerial/drone) is what actually moves a listing at this price point.
- Mention video as the primary offer; mention photography as something Lukas also does, briefly, not as an equal second headline.
- Include the same practical details as the reference email where relevant (turnaround, drone, flexible scheduling) but don't just copy its sentences.
- End with the same sign-off block: Lukas Hahn / Hahn Media / https://www.lukashahn.art/real-estate / (541) 430-3372
- 120-180 words in the body (longer than the reference email is fine — this is an email, not a text — but don't pad it).

Writing rules (these matter — this needs to sound like a real person, not marketing copy):
- NEVER use an em dash (—) or en dash (–), anywhere. Use a period or comma instead.
- Never use these words/phrases — dead giveaways of AI writing: "I noticed," "I wanted to reach out," "I hope this finds you," "don't hesitate," "in case you," "showcase"/"showcasing," "ensure," "delve," "reach out," "take care of," "beautifully," "stunning," "reliable," "pivotal," "crucial," "elevate," "take your listing to the next level," "best-in-class," "earn your business."
- Contractions and plain phrasing over polished sentences.
- Zero or one exclamation point total.
- Don't write in a symmetric "not just X, but Y" or rule-of-three pattern.

Respond with ONLY valid JSON, no markdown fences, no explanation, in exactly this shape:
{"subject": "...", "body": "..."}
The body should use \\n\\n between paragraphs (plain text email, matching the reference's spacing), and end with the sign-off block on its own lines.`;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  const text = await callGemini({
    model: "gemini-3.5-flash",
    apiKey,
    parts: [{ text: PROMPT }],
    generationConfig: { temperature: 0.9 },
    logLabel: "gen-preset (temp)",
  });

  if (!text) return NextResponse.json({ error: "Gemini returned nothing" }, { status: 502 });

  return NextResponse.json({ raw: text });
}
