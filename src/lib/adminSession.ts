import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The password gate for the admin web app.
 *
 * The custom domain realestate.lukashahn.art serves the whole app — agent
 * phone numbers, every server action that writes — to anyone who asks,
 * because the *.vercel.app URLs that sit behind Vercel SSO are only one of
 * the ways in. This is the whole sign-in: one password, typed once, kept as a
 * signed cookie for as long as the browser will hold it.
 *
 * Server-only by construction (it imports node:crypto), and safe to import
 * from Proxy as well as pages, actions and route handlers.
 */

export const SESSION_COOKIE = "lf_session";

// Browsers cap cookie lifetime at 400 days, and there's no reason to expire
// this sooner: the app is single-user, and being logged out mid-season would
// be worse than a long-lived cookie on a device only Lukas has.
export const SESSION_MAX_AGE = 400 * 24 * 60 * 60;

// A version marker inside the signed payload, so a future change to what's
// signed can't be read as a valid older session.
const SESSION_TOKEN_LABEL = "lf-admin-v1";

/**
 * Whether the gate should be enforced at all.
 *
 * Local dev: both vars unset means no gate, so the app behaves exactly as it
 * did before this existed and developing against it needs no ceremony.
 * Production: same condition, but authMisconfigured() reports it and Proxy
 * fails closed, so a deploy that forgot a var locks Lukas out of his own
 * admin rather than publishing it.
 */
export function authGateEnabled(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD) && Boolean(process.env.SESSION_SECRET);
}

/** In production with a var missing, the name of the one that's missing. */
export function authMisconfigured(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (!process.env.ADMIN_PASSWORD) return "ADMIN_PASSWORD";
  if (!process.env.SESSION_SECRET) return "SESSION_SECRET";
  return null;
}

/**
 * The cookie value for a signed-in session: HMAC-SHA256 of a fixed label,
 * base64url. Deterministic, so it needs no storage and survives a restart —
 * every signed-in browser presents the same value and it's still unforgeable
 * without SESSION_SECRET.
 */
export function sessionToken(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(SESSION_TOKEN_LABEL).digest("base64url");
}

/**
 * Both sides hashed before comparison so a candidate of any length can be
 * compared with timingSafeEqual, which throws on a length mismatch and would
 * otherwise leak length by throwing instead of returning false.
 */
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export function isValidSession(cookieValue: string | undefined): boolean {
  const expected = sessionToken();
  if (!expected || !cookieValue) return false;
  return safeEqual(cookieValue, expected);
}

/** Hashes rather than compares directly, so the comparison is always between two fixed-length digests. */
export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(input, expected);
}

/**
 * A `?next=` destination is only allowed to stay inside this app. It has to be
 * a root-relative path: "//evil.example" is a protocol-relative URL that would
 * bounce a just-authenticated browser straight off to another origin with the
 * referer attached, and "/login" would loop. Anything else falls back to the
 * app root. Shared by Proxy (signed-in visitors skip the login page) and the
 * sign-in action, so the two can't disagree about what's safe.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) return "/";
  return value;
}
