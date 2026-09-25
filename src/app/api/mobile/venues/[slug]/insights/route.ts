import { insightsJson } from "@/lib/mobile/insights-json";
import { fail, ok } from "@/lib/mobile/respond";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/mobile/venues/{slug}/insights?period=today|7d|30d|90d — #33.
 *
 * Any member, like the run sheet: how busy the venue is, is something the
 * people working it should be able to see.
 *
 * An unknown period falls back to 30 days rather than erroring — it arrives
 * from a query string, and `rangeDays` already decides that.
 */
export async function GET(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const period = new URL(request.url).searchParams.get("period");
  return ok({
    insights: await insightsJson(scope.organizationId, scope.timezone, period),
  });
}
