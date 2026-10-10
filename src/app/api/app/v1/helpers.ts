import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Shared plumbing for the iPhone app's JSON API (/api/app/v1/*).
 *
 * The conventions every route here follows — bearer auth (lib/appApiAuth.ts),
 * id validation before a query, 400 with a readable message for a bad body,
 * 404 for a malformed or unknown id — live here so each route file is just its
 * handler. Server-only by construction: it imports next/server.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function badRequest(error: string): Response {
  return NextResponse.json({ error }, { status: 400 });
}

export function notFound(): Response {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

export function unauthorized(): Response {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/**
 * A body that isn't valid JSON is a 400 with the parser's own complaint rather
 * than a 500 — the app sends this, so a bug there should say so plainly.
 */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body == null || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("body must be a JSON object");
    }
    return body as Record<string, unknown>;
  } catch (err) {
    throw new BadBody(err instanceof Error ? err.message : "invalid JSON body");
  }
}

/** Thrown by readJson/parseEnum and turned into a 400 by `withErrors`. */
export class BadBody extends Error {}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new BadBody(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function optionalString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new BadBody(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function optionalNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadBody(`${field} must be a number`);
  }
  return value;
}

export function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value, field);
  if (!parsed) throw new BadBody(`${field} is required`);
  return parsed;
}

/** A booking's line items: `[{ description, amount }]`, amount in whole dollars. */
export function lineItemList(value: unknown, field: string): { description: string; amount: number }[] {
  if (!Array.isArray(value)) throw new BadBody(`${field} must be an array`);
  return value.map((item, i) => {
    if (item == null || typeof item !== "object") throw new BadBody(`${field}[${i}] must be an object`);
    const { description, amount } = item as Record<string, unknown>;
    if (typeof description !== "string") throw new BadBody(`${field}[${i}].description must be a string`);
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      throw new BadBody(`${field}[${i}].amount must be a number, 0 or more`);
    }
    return { description, amount: Math.round(amount) };
  });
}

export function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new BadBody(`${field} must be a non-empty array`);
  return value.map((item, i) => requiredString(item, `${field}[${i}]`));
}

/** An ISO date string → Date, rejecting anything unparseable. */
export function optionalDate(value: unknown, field: string): Date | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new BadBody(`${field} must be an ISO date string`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadBody(`${field} must be an ISO date string`);
  return date;
}

/** Wraps a handler so a BadBody becomes a 400 instead of a 500. */
export function withErrors<T extends unknown[]>(handler: (...args: T) => Promise<Response>) {
  return async (...args: T): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof BadBody) return badRequest(err.message);
      throw err;
    }
  };
}

/**
 * ETag over the response body, plus the 304 that goes with it. The agent list
 * and the caller-ID table are the two payloads big enough and stable enough to
 * be worth re-fetching conditionally — the app pulls them on every foreground.
 */
// sha1 is plenty: this only ever detects "unchanged", it is not a security
// boundary, and it keeps the header short on a ~6,000-agent payload.
export function bodyEtag(body: string): string {
  return `"${createHash("sha1").update(body).digest("base64url")}"`;
}

export function etagged(body: string, ifNoneMatch: string | null): Response {
  const tag = bodyEtag(body);
  if (ifNoneMatch && ifNoneMatch.split(",").some((candidate) => candidate.trim() === tag)) {
    return new Response(null, { status: 304, headers: { ETag: tag } });
  }
  return new Response(body, { status: 200, headers: { ETag: tag, "Content-Type": "application/json" } });
}
