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

Critical context that must shape the whole email — read carefully:
- Lukas noticed this agent because of a specific listing ({{street}}), so that listing is the REASON he's reaching out (it's what put this agent on his radar) — but he is NOT offering to shoot that particular property. If he's seeing it as an already-listed property, it almost certainly already has its media handled. Do NOT say anything like "let me shoot this one" or "I can help with this listing" or "if you still need photos for this property."
- Do NOT say the listing was noticed "a while back" or otherwise imply a stale/delayed reference to it — keep the timing vague or immediate instead.
- The actual goal: introduce himself, make sure the agent knows who he is and what he does (video for high-end listings specifically, photo too), and ask to be kept in mind for a FUTURE listing — not any specific one, not urgent, no ask to act now.
- Casual, no pressure, acknowledging they probably already have someone, positioning himself as a specialist/backup option for the video side specifically, not trying to replace anyone or win a job today.
- Do NOT promise a 24-hour turnaround/delivery for video — not realistic for video editing, leave any turnaround-time claim out entirely.
- He has real video samples to point to (two walkthroughs and a short) that were featured in the Eugene Tour of Homes — include a line pointing to them followed by these three links, each on its own line, EXACTLY as given below (do not alter, shorten, or wrap them):
https://www.youtube.com/watch?v=FIl7kcGSBRI
https://youtu.be/pYjeklEaM8U
https://youtube.com/shorts/iODhMDAwVn0

Below is a REAL email Lukas actually sent to an agent (Ryan) — use this as your primary reference for VOICE, TONE, and STYLE (not structure — that email was a warm follow-up after a real conversation, this one is cold outreach to someone who's never heard of him). Match how plainly and concretely he writes: short sentences, no fluff, states his real prices as plain facts rather than vaguely gesturing at "attached pricing," friendly but businesslike, not salesy.

---
Subject: Real Estate Media Portfolio

Hi there Ryan!

Thank you for your time.

Here are a few samples of videos I filmed recently that were featured in the Eugene Tour of Homes.
https://www.youtube.com/watch?v=FIl7kcGSBRI
https://youtu.be/pYjeklEaM8U
https://youtube.com/shorts/iODhMDAwVn0

Here are a few examples of my recent photo work:
[photos]

As for pricing, my business charges $400 for a 1-2 minute walkthrough video including drone footage, and an extra $100 for a social media reel.

Interior/exterior photos separately are $300, $100 extra for drone photography.

I bundle both together (walkthrough video, social media reel, drone footage, interior/exterior photos) all for $700.

Thank you Ryan, I look forward to the possibility of working with you.

Lukas Hahn
Hahn Media
https://www.lukashahn.art/real-estate
(541) 430-3372
---

Write the new cold-outreach version with this shape:
- Subject: short, not property-specific (this isn't about one listing).
- Greeting in the same style as the reference: "Hi there {{firstName}}!" (or close to it).
- Open by referencing {{street}} only as the reason he noticed this agent — one sentence, no time qualifier like "a while back," no pitch attached to it.
- Briefly introduce himself as a local video specialist for higher-end/architectural properties (cinematic walkthrough, drone), photography also something he does. Echo the "not trying to replace anyone" framing (most agents don't have a dedicated video person the way they have a go-to photographer, so frame it as wanting to be their video option).
- Include the YouTube samples line and the three links exactly as specified above.
- Include real pricing as plain stated facts, matching the reference's directness — reuse the same numbers from the reference email ($400 walkthrough video w/ drone, +$100 social media reel, $300 photos separately, +$100 drone photos, $700 bundle) rather than vaguely saying "I've attached my pricing."
- Do NOT mention 24-hour delivery or any specific turnaround time.
- Close with a soft, no-pressure ask to be kept in mind for a future listing — no urgency, nothing to act on right now. Then a short, genuine-sounding thank-you line similar to the reference's closing.
- End with the same sign-off block: Lukas Hahn / Hahn Media / https://www.lukashahn.art/real-estate / (541) 430-3372
- 130-190 words in the body, not counting the three link lines and the pricing lines.

Writing rules (these matter — this needs to sound like a real person, not marketing copy):
- NEVER use an em dash (—) or en dash (–), anywhere. Use a period or comma instead.
- Never use these words/phrases — dead giveaways of AI writing: "I noticed," "I wanted to reach out," "I hope this finds you," "don't hesitate," "in case you," "showcase"/"showcasing," "ensure," "delve," "reach out," "take care of," "beautifully," "stunning," "reliable," "pivotal," "crucial," "elevate," "take your listing to the next level," "best-in-class," "earn your business."
- Contractions and plain phrasing over polished sentences.
- Zero or one exclamation point total.
- Don't write in a symmetric "not just X, but Y" or rule-of-three pattern.

Respond with ONLY valid JSON, no markdown fences, no explanation, in exactly this shape:
{"subject": "...", "body": "..."}
The body should use \\n\\n between paragraphs (plain text email, matching the reference's spacing) — put each of the three YouTube links on its own line, separated by \\n not \\n\\n — and end with the sign-off block on its own lines.`;

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
