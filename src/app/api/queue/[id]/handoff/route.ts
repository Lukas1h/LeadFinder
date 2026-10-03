import { NextRequest, NextResponse } from "next/server";
import { markQueuedTextOpened } from "@/app/queue/actions";

/**
 * The Queue page's Send-text log. Does what the server action does, but as a
 * plain route so the page can reach it with an ordinary fetch: server actions
 * wait in Next's router queue behind any refresh still in flight, and the
 * Queue page refreshes constantly (every few seconds while AI drafts are
 * being written, and after every skip/delete/send) — so the call regularly
 * hadn't left yet when iOS froze the app on opening Messages, and the
 * did-it-send question never appeared.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await markQueuedTextOpened(id);
  return NextResponse.json({ ok: true });
}
