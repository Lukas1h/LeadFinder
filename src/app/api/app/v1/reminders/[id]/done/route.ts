import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { setReminderDone } from "@/app/schedule/actions";
import { isUuid, notFound, readJson, withErrors } from "../../../helpers";

/** Tick a reminder off, or untick it — `done: false` puts it back on the list. */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);
  if (typeof body.done !== "boolean") {
    return NextResponse.json({ error: "done must be a boolean" }, { status: 400 });
  }

  await setReminderDone(id, body.done);
  return NextResponse.json({ ok: true });
});
