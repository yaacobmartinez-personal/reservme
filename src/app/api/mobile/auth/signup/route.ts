import { z } from "zod";
import { auth } from "@/lib/auth";
import { fromAuthError, fail, invalid, ok } from "@/lib/mobile/respond";
import { userJson } from "@/lib/mobile/session";

export const dynamic = "force-dynamic";

/**
 * Better Auth's own minimum is 10 characters (src/lib/auth.ts). The app states
 * the same number on the sign-up screen, so keep them in step or the server
 * will refuse something the app told the owner was fine.
 */
const schema = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(120),
  email: z.string().trim().toLowerCase().email("That email doesn't look right."),
  password: z.string().min(10, "Use at least 10 characters."),
});

/**
 * POST /api/mobile/auth/signup — API-CONTRACT #25.
 *
 * `{name, email, password}` → `201 {token, user}`.
 *
 * Signs the new owner straight in, because the very next thing onboarding does
 * is create their venue and that needs a session. Verification is sent but not
 * required — gating the venue step behind a clicked link would 401 every new
 * owner halfway through setting up.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "email");
      fieldErrors[key] ??= issue.message;
    }
    return invalid(fieldErrors);
  }

  const { name, email, password } = parsed.data;

  try {
    const response = await auth.api.signUpEmail({
      body: { name, email, password },
      headers: request.headers,
      asResponse: true,
    });

    const body = (await response.json()) as {
      user?: { id: string; email: string; name?: string | null; emailVerified?: boolean };
      message?: string;
    };

    if (!response.ok || !body.user) {
      // Better Auth answers 422 for an address that already has an account.
      if (response.status === 422) {
        return fail(409, {
          error: "conflict",
          reason: "email_taken",
          message: "That email already has an account. Sign in instead.",
          fieldErrors: { email: "That email already has an account." },
        });
      }
      return fromAuthError(
        { statusCode: response.status, body },
        "We couldn't create that account.",
      );
    }

    const token = response.headers.get("set-auth-token");
    if (!token) {
      return fail(500, {
        error: "server_error",
        message: "Account created, but sign-in failed. Try signing in.",
      });
    }

    // A six-digit code, because the app cannot receive a click. Best effort:
    // the account exists either way and the app offers "Skip for now", so a
    // mail outage must not lose the owner their sign-up.
    await auth.api
      .sendVerificationOTP({ body: { email, type: "email-verification" } })
      .catch(() => {});

    return ok(
      {
        token,
        user: userJson({
          id: body.user.id,
          email: body.user.email,
          name: body.user.name ?? name,
          emailVerified: Boolean(body.user.emailVerified),
        }),
      },
      201,
    );
  } catch (error) {
    return fromAuthError(error, "We couldn't create that account.");
  }
}
