import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { createReminder } from "@/app/schedule/actions";
import { badRequest, optionalNumber, optionalString, readJson, requiredString, withErrors } from "../helpers";

/**
 * Add a reminder. The body is a ReminderInput, but only title and date are
 * actually required — everything else defaults the way an all-day, unlinked
 * reminder would in the web's dialog. The web's own validation still decides
 * what's acceptable (date shape, time format, title non-empty), so the app
 * can't create something the web wouldn't.
 */
export const POST = withErrors(async (req: Request) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const body = await readJson(req);
  const input = {
    title: requiredString(body.title, "title"),
    date: requiredString(body.date, "date"),
    time: optionalString(body.time, "time"),
    durationMinutes: optionalNumber(body.durationMinutes, "durationMinutes"),
    notes: optionalString(body.notes, "notes"),
    agentId: optionalString(body.agentId, "agentId"),
    bookingId: optionalString(body.bookingId, "bookingId"),
  };

  const { error } = await createReminder(input);
  if (error) return badRequest(error);

  return NextResponse.json({ ok: true });
});
