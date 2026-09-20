import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/gemini";

// Temporary, one-off route to regenerate the "High-End Video & Photo" email
// preset's copy via Gemini in production (the only place a real API key
// exists) — removed once the content is generated and reviewed.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.MCP_SHARE_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const PROMPT = `You are writing a cold outreach EMAIL from Lukas Hahn, a local real estate photographer/videographer, to real estate agents — specifically ones who list high-end, expensive, architecturally interesting properties.

Two earlier drafts were generated. Lukas's feedback on the second one (currently live): the opening line "Your listing on {{street}} caught my eye" reads as cheesy and needs to be redone with something plainer. He also wants the whole email more casual, a bit more concise, and less "perfectly written" — a couple of small natural imperfections (inconsistent hyphenation, a slightly looser sentence here or there) so it reads like a real person typed it, not polished marketing copy. He said he actually liked the FIRST draft a bit better overall and wants this version to take a bit of both.

--- DRAFT 1 (liked slightly better) ---
Subject: Video for high-end listings

Hi {{firstName}},

I came across your listing on {{street}} and really liked the architecture.

I'm Lukas, a local videographer specializing in high-end, architectural properties. I shoot cinematic video tours and drone work, and I handle photography too. I know you probably already have a go-to photographer, so I'm not trying to replace them. But many agents don't have a dedicated video person for their premium listings. I want to be your video option when you have a special property that needs a cinematic walkthrough.

Here are a couple of recent walkthroughs featured in the Eugene Tour of Homes:
https://www.youtube.com/watch?v=FIl7kcGSBRI
https://youtu.be/pYjeklEaM8U
https://youtube.com/shorts/iODhMDAwVn0

I've attached my pricing.

No pressure at all, but keep me in mind for your next high-end listing where video would help. I'd love to work together down the road!

Lukas Hahn
Hahn Media
https://www.lukashahn.art/real-estate
(541) 430-3372
--- END DRAFT 1 ---

--- DRAFT 2 (currently live, opening line is the problem) ---
Subject: Real estate video and photo

Hi there {{firstName}}!

Your listing on {{street}} caught my eye. I focus on high-quality video and photography for properties with unique architecture and design.

You likely already have a photographer you like to use, but many local agents don't have a dedicated person for video. I specialize in cinematic walkthroughs and drone footage that help buyers feel like they are walking through the space.

If you ever need a backup option or want to add a high-end video to a future listing, I would love to help.

Here are a few samples of videos I filmed recently that were featured in the Eugene Tour of Homes.
https://www.youtube.com/watch?v=FIl7kcGSBRI
https://youtu.be/pYjeklEaM8U
https://youtube.com/shorts/iODhMDAwVn0

As for pricing, my business charges $400 for a 1-2 minute walkthrough video including drone footage, and an extra $100 for a social media reel.

Interior/exterior photos separately are $300, $100 extra for drone photography.

I bundle both together (walkthrough video, social media reel, drone footage, interior/exterior photos) all for $700.

There is no pressure to reply to this today. I just thought I would introduce myself and ask you to keep me in mind for your next unique property.

Thank you for your time, and I look forward to the possibility of working with you in the future.

Lukas Hahn
Hahn Media
https://www.lukashahn.art/real-estate
(541) 430-3372
--- END DRAFT 2 ---

Write a new version blending the two, with these fixes:
- Opening line: do NOT use "caught my eye" or anything similarly flowery ("stopped me in my tracks", "grabbed my attention", etc). Go with something plain and low-key like draft 1's "I came across your listing on {{street}}" — you can keep "and really liked the architecture" or drop it, your call, just keep it simple and not salesy. No time qualifier like "a while back."
- Keep draft 1's self-intro sentence structure ("I'm Lukas, a local videographer specializing in...") — it's more natural than draft 2's "I focus on..." opener.
- Keep draft 2's concrete, plainly-stated real pricing (the exact numbers: $400 walkthrough video w/ drone, +$100 social media reel, $300 photos separately, +$100 drone photos, $700 bundle) instead of draft 1's vague "I've attached my pricing" — but compress it, it doesn't need three separate paragraphs. Two sentences is enough.
- Keep the "not trying to replace your photographer, just want to be the video option" framing (both drafts have a version of this — pick whichever phrasing feels least stiff).
- Keep the YouTube samples line and the three links exactly as given below, each on its own line:
https://www.youtube.com/watch?v=FIl7kcGSBRI
https://youtu.be/pYjeklEaM8U
https://youtube.com/shorts/iODhMDAwVn0
- Do NOT mention 24-hour delivery or any turnaround time.
- Do NOT pitch shooting {{street}} itself — it's just the reason he noticed this agent, the actual ask is being kept in mind for a future listing, no pressure, nothing to act on now.
- Sign-off block stays: Lukas Hahn / Hahn Media / https://www.lukashahn.art/real-estate / (541) 430-3372
- Overall: shorter than draft 2. Aim for 100-140 words in the body, not counting links, pricing sentence, and sign-off.
- Make it read like a real person typed it in one sitting, not a polished template: vary sentence length, let one sentence run a little casual/loose, don't over-punctuate. It's fine (even good) to be slightly inconsistent with hyphenation across the email (e.g. write "high end" without a hyphen in one spot even though "high-end" is technically correct) — small imperfections like that are wanted, not a mistake to avoid. Do not introduce actual typos, misspellings, or grammar that would look like a mistake rather than a casual choice.

Writing rules (these still matter):
- NEVER use an em dash (—) or en dash (–), anywhere. Use a period or comma instead.
- Never use these words/phrases — dead giveaways of AI writing: "I noticed," "I wanted to reach out," "I hope this finds you," "don't hesitate," "in case you," "showcase"/"showcasing," "ensure," "delve," "reach out," "take care of," "beautifully," "stunning," "reliable," "pivotal," "crucial," "elevate," "take your listing to the next level," "best-in-class," "earn your business," "caught my eye," "stopped me in my tracks."
- Contractions and plain phrasing over polished sentences.
- Zero or one exclamation point total.
- Don't write in a symmetric "not just X, but Y" or rule-of-three pattern.

Respond with ONLY valid JSON, no markdown fences, no explanation, in exactly this shape:
{"subject": "...", "body": "..."}
The body should use \\n\\n between paragraphs (plain text email) — put each of the three YouTube links on its own line, separated by \\n not \\n\\n — and end with the sign-off block on its own lines.`;

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
