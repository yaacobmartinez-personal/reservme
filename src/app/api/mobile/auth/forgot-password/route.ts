import { z } from "zod";
import { auth } from "@/lib/auth";
import { ok, rateLimited } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().toLowerCase().email() });

/**
 * POST /api/mobile/auth/forgot-password — API-CONTRACT #11.
 *
 * `{email}` → `{ok: true}`, always, including for a malformed address and one
 * with no account. This endpoint is unauthenticated, so any difference in the
 * answer turns it into a way to ask whether an address is registered here.
 *
 * The rate limit is the one exception, and it has to be: the alternative is an
 * open email cannon pointed at any address someone types.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return ok({ ok: true });

  try {
    await auth.api.requestPasswordResetEmailOTP({
      body: { email: parsed.data.email },
      headers: request.headers,
    });
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 429) {
      return rateLimited("Too many requests. Try again in a few minutes.");
    }
    // Unknown address, or mail trouble. Same answer either way.
  }

  return ok({ ok: true });
}
