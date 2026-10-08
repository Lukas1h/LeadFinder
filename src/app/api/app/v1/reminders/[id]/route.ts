import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { deleteReminder, updateReminder } from "@/app/schedule/actions";
import { badRequest, isUuid, notFound, optionalNumber, optionalString, readJson, requiredString, withErrors } from "../../helpers";

/** Edit a reminder in place — the same fields creation takes. */
export const PUT = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);
  const { error } = await updateReminder(id, {
    title: requiredString(body.title, "title"),
    date: requiredString(body.date, "date"),
    time: optionalString(body.time, "time"),
    durationMinutes: optionalNumber(body.durationMinutes, "durationMinutes"),
    notes: optionalString(body.notes, "notes"),
    agentId: optionalString(body.agentId, "agentId"),
    bookingId: optionalString(body.bookingId, "bookingId"),
  });
  if (error) return badRequest(error);

  return NextResponse.json({ ok: true });
});

/** Delete a reminder outright. */
export const DELETE = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  await deleteReminder(id);
  return NextResponse.json({ ok: true });
});
