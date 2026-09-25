import { auth } from "@/lib/auth";
import { ok, rateLimited, unauthorized } from "@/lib/mobile/respond";
import { mobileUser } from "@/lib/mobile/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/auth/resend-verification — API-CONTRACT #25.
 *
 * Always `{ok: true}` for a signed-in user whose address is unverified, and
 * also for one already verified: a second code for an address that needs none
 * is just noise, and saying so would be a needless error state on a screen the
 * owner is trying to leave.
 */
export async function POST(request: Request) {
  const user = await mobileUser(request);
  if (!user) return unauthorized();
  if (user.emailVerified) return ok({ ok: true });

  try {
    await auth.api.sendVerificationOTP({
      body: { email: user.email, type: "email-verification" },
      headers: request.headers,
    });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 429) return rateLimited("Wait a moment before asking for another code.");
    // A mail failure is ours, not theirs; the code they already have still works.
  }

  return ok({ ok: true });
}
