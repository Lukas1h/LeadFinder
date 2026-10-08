import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authMisconfigured } from "@/lib/adminSession";
import { signIn } from "./actions";

// No nav chrome here: Proxy sets x-gallery-view for /login (see the comment on
// GALLERY_VIEW_HEADER), so layout.tsx renders this bare rather than wrapping a
// sign-in form in links nobody can follow yet.
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      {/* searchParams is request-time data, so it's read below this boundary
          rather than in the page — that keeps the shell around the card
          prerenderable. */}
      <Suspense fallback={<LoginCard />}>
        <LoginCardContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function LoginCard({ error, misconfigured, next }: { error?: boolean; misconfigured?: string | null; next?: string } = {}) {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-xl font-semibold tracking-tight">LeadFinder</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={signIn} className="flex flex-col gap-4">
          {/* Not a real field — iOS Keychain only offers to save a password when
              the form names a username, and this app has exactly one user. */}
          <input type="text" name="username" value="lukas" autoComplete="username" readOnly hidden />
          <input type="hidden" name="next" value={next ?? "/"} />
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Password"
            autoFocus
            required
          />
          <Button type="submit">Sign in</Button>
        </form>

        {misconfigured ? (
          <p className="mt-4 text-sm text-destructive text-center">
            Sign-in is not configured: {misconfigured} is not set.
          </p>
        ) : error ? (
          <p className="mt-4 text-sm text-destructive text-center">Wrong password</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

async function LoginCardContent({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  return (
    <LoginCard
      error={first(params.error) === "1"}
      misconfigured={authMisconfigured()}
      next={first(params.next)}
    />
  );
}
