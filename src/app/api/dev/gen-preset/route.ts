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

const PROMPT = `You are writing a cold outreach EMAIL from Lukas Hahn, a local real estate photographer/videographer, to real estate agents — specifically ones who list high-end, expensive, architecturally interesting properties. This is a video-focused version of his existing "backup photographer" email, matching its exact vibe and intent, NOT a pitch to shoot any specific property.

Critical context that must shape the whole email — read carefully:
- Lukas noticed this agent because of a specific listing ({{street}}), so that listing is the REASON he's reaching out (it's what put this agent on his radar) — but he is NOT offering to shoot that particular property. If he's seeing it as an already-listed property, it almost certainly already has its media handled. Do NOT say anything like "let me shoot this one" or "I can help with this listing" or "if you still need photos for this property."
- Do NOT say the listing was noticed "a while back" or otherwise imply a stale/delayed reference to it — keep the timing vague or immediate instead (e.g. just "I came across your listing on {{street}}" with no time qualifier, or something equally neutral).
- The actual goal is completely different from "get this job": introduce himself, make sure the agent knows who he is and what he does (video for high-end listings specifically, photo too), and ask to be kept in mind for a FUTURE listing — not any specific one, not urgent, no ask to act now.
- Same "backup photographer" energy as his other template: casual, no pressure, acknowledging they probably already have someone, positioning himself as a specialist/backup option for the video side specifically, not trying to replace anyone or win a job today.
- Do NOT promise a 24-hour turnaround/delivery for video — that's a photo-only promise from the reference email and isn't realistic for video editing, so leave any turnaround-time claim out entirely for this version.
- He has real video samples to point to (two walkthroughs and a short) that were featured in the Eugene Tour of Homes — include a short line like "Here are a couple of recent walkthroughs featured in the Eugene Tour of Homes:" followed by these three links, each on its own line, EXACTLY as given below (do not alter, shorten, or wrap them):
https://www.youtube.com/watch?v=FIl7kcGSBRI
https://youtu.be/pYjeklEaM8U
https://youtube.com/shorts/iODhMDAwVn0

For reference, here is Lukas's existing "backup photographer" cold email — match this one's structure, vibe, and restraint almost exactly, just recontextualized around video/high-end listings instead of being general-purpose backup:

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

Write the new version with this shape:
- Subject: short, not property-specific (this isn't about one listing).
- Open by referencing {{street}} only as the reason he noticed this agent — one sentence, no time qualifier like "a while back," no pitch attached to it.
- Pivot immediately to introducing himself as a local video specialist for higher-end/architectural properties — cinematic walkthrough, drone — with photography as something he also does, mentioned briefly, not the headline.
- Explicitly echo the "not trying to replace anyone" framing from the reference email, adapted to video (most agents don't have a dedicated video person the way they have a go-to photographer, so this can be framed as "wanted to be your video option" rather than literally "not replacing your videographer").
- Include the YouTube samples line and the three links exactly as specified above, placed naturally after he's introduced what he does (not at the very top, not buried at the end past the sign-off).
- Do NOT mention 24-hour delivery or any specific turnaround time.
- Close with a soft, no-pressure ask to be kept in mind for a future listing — NOT "let me know if you need this one done" — something like being on their radar for whenever video would help down the road. No urgency, nothing to act on right now.
- End with the same sign-off block: Lukas Hahn / Hahn Media / https://www.lukashahn.art/real-estate / (541) 430-3372
- You may mention "I've attached my pricing" if it fits naturally, phrased exactly like the reference. Do not claim any other attachments (no "attached video tours," no "attached samples") since the video samples are the YouTube links, not a file.
- 110-170 words in the body, not counting the three link lines.

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
