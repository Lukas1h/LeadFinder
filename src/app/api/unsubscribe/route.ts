import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { readUnsubscribeToken } from "@/lib/unsubscribe";

export const maxDuration = 30;

/**
 * The endpoint behind the List-Unsubscribe header on every cold email.
 *
 * GET is a human clicking the link in a mail client. POST is RFC 8058
 * one-click, which Gmail and Yahoo fire silently from the "Unsubscribe" button
 * in the UI — that request carries no cookies and no session, so the token in
 * the URL is the entire authorisation, which is why it's an authenticated
 * ciphertext rather than an address.
 *
 * Answers 200 either way once handled. A one-click POST that returns an error
 * leaves the sender looking non-compliant to the provider, and the recipient has
 * already said what they wanted.
 */
async function handle(req: NextRequest): Promise<Response> {
  const token = new URL(req.url).searchParams.get("t");
  const email = token ? readUnsubscribeToken(token) : null;
  if (!email) {
    return NextResponse.json({ error: "invalid or expired unsubscribe link" }, { status: 400 });
  }

  // Case- and whitespace-insensitive, because the token lowercases the address
  // while the agents table stores whatever the importer scraped.
  const [row] = await db
    .update(agents)
    .set({ emailUnsubscribedAt: new Date() })
    .where(and(eq(sql`lower(trim(${agents.email}))`, email)))
    .returning({ name: agents.name });

  // No matching row is still a success from the recipient's side — there is
  // simply nothing left to suppress (they may have been deleted, or never had
  // an agent row). Only log a count, never the address, so this stays safe to
  // ship without leaking who opted out into logs.
  if (!row) {
    console.log(`unsubscribe: no agent row matched for a token issued before this address existed`);
  }

  const name = row?.name?.trim();
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;color:#18181b">
<h1 style="font-size:1.25rem;margin:0 0 .75rem">You're unsubscribed</h1>
<p style="margin:0 0 .75rem;line-height:1.6">${name ? `${escapeHtml(name)}, you` : "You"} won't get any more
cold emails from Hahn Media. Sorry to have been in your inbox.</p>
<p style="margin:0;line-height:1.6;color:#71717a;font-size:.875rem">If you got here by mistake, or you only wanted
to stop hearing about one property, just reply and say so.</p>
</body></html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
