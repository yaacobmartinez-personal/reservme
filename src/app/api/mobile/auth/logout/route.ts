import { auth } from "@/lib/auth";
import { ok } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/auth/logout — API-CONTRACT #12.
 *
 * Always `{ok: true}`. The app forgets the token regardless of what we say, so
 * a failure here would only produce an error toast on the way out the door;
 * the worst case is a session row that expires on its own schedule.
 */
export async function POST(request: Request) {
  try {
    await auth.api.signOut({ headers: request.headers });
  } catch {
    // Already gone, or never valid.
  }
  return ok({ ok: true });
}
