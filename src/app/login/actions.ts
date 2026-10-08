"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkPassword,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  sessionToken,
} from "@/lib/adminSession";

/**
 * A wrong password deliberately costs about a second before it says so, so the
 * form can't be used to guess the password by measuring response time. The
 * delay is only on the failure path — a correct password is instant.
 */
const WRONG_PASSWORD_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function signIn(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""));

  if (!checkPassword(password)) {
    await sleep(WRONG_PASSWORD_DELAY_MS);
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const token = sessionToken();
  if (token) {
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // "lax" rather than "strict": a link straight from an email into the app
      // should still carry the cookie. Nothing here is cross-site embeddable.
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
  }

  redirect(next);
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
