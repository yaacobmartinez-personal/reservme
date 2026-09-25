import { z } from "zod";
import { auth } from "@/lib/auth";
import { fail, invalid, ok, unauthorized } from "@/lib/mobile/respond";
import { mobileUser, userJson } from "@/lib/mobile/session";

export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the six digits.") });

/**
 * POST /api/mobile/auth/verify — API-CONTRACT #25.
 *
 * `{code}` → `{user}`. The address comes from the session, not the body: the
 * app is signed in by this point, and taking an email here would let anyone
 * with a code verify somebody else's address.
 */
export async function POST(request: Request) {
  const user = await mobileUser(request);
  if (!user) return unauthorized();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid({ code: "Enter the six digits." });

  try {
    await auth.api.verifyEmailOTP({
      body: { email: user.email, otp: parsed.data.code },
      headers: request.headers,
    });
  } catch {
    // One message whatever went wrong — expired, wrong, or already used. The
    // app shows it under the field, and the distinction helps nobody who is
    // guessing.
    return fail(400, {
      error: "invalid",
      message: "That code doesn't match. Check the email again.",
      fieldErrors: { code: "That code doesn't match. Check the email again." },
    });
  }

  return ok({ user: userJson({ ...user, emailVerified: true }) });
}
