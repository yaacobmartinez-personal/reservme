import { fail, ok } from "@/lib/mobile/respond";
import { todayView } from "@/lib/mobile/today-json";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/mobile/venues/{slug}/today — API-CONTRACT #14.
 *
 * → `{date, stats, runSheet}`. Any member: running the day is the job every
 * staff account is for, unlike the structural edits that need owner or admin.
 *
 * The app caches this and renders the cached copy with a stale banner when it
 * cannot reach us, so the response is deliberately self-contained — nothing
 * here needs a second request to be readable.
 */
export async function GET(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  return ok(await todayView(scope.organizationId, scope.timezone));
}
