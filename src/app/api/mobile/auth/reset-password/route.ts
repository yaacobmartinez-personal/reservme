import { z } from "zod";
import { auth } from "@/lib/auth";
import { fail, invalid, ok, rateLimited } from "@/lib/mobile/respond";
import { userJson } from "@/lib/mobile/session";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().regex(/^\d{6}$/),
  password: z.string().min(10, "Use at least 10 characters."),
});

/**
 * POST /api/mobile/auth/reset-password — API-CONTRACT #26.
 *
 * `{email, code, password}` → `{token, user}`, signed straight back in so the
 * reset ends on a working app rather than on a login screen.
 *
 * A wrong code and an unknown address refuse in the *same* words. Getting this
 * wrong would undo the silence of the request step above: ask for a reset for
 * an address, type any six digits, and a different refusal tells you whether
 * the account exists.
 */
const REFUSAL = "That code doesn't match. Check the email again.";

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const weak = parsed.error.issues.find((i) => i.path[0] === "password");
    if (weak) return invalid({ password: weak.message });
    return invalid({ code: REFUSAL }, REFUSAL);
  }

  const { email, code, password } = parsed.data;

  try {
    await auth.api.resetPasswordEmailOTP({
      body: { email, otp: code, password },
      headers: request.headers,
    });
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 429) return rateLimited();
    return fail(400, { error: "invalid", message: REFUSAL, fieldErrors: { code: REFUSAL } });
  }

  // Reset done. Sign in with the password we just set rather than minting a
  // session by hand, so there is exactly one place a session is created.
  try {
    const response = await auth.api.signInEmail({
      body: { email, password },
      headers: request.headers,
      asResponse: true,
    });
    const token = response.headers.get("set-auth-token");
    const body = (await response.json()) as {
      user?: { id: string; email: string; name?: string | null; emailVerified?: boolean };
    };
    if (response.ok && token && body.user) {
      return ok({
        token,
        user: userJson({
          id: body.user.id,
          email: body.user.email,
          name: body.user.name ?? null,
          emailVerified: Boolean(body.user.emailVerified),
        }),
      });
    }
  } catch {
    // Fall through: the password did change, which is the part that matters.
  }

  return ok({ ok: true });
}
