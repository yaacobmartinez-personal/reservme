import { fail, ok } from "@/lib/mobile/respond";
import { teamJson } from "@/lib/mobile/team-json";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/mobile/venues/{slug}/team — API-CONTRACT #31.
 *
 * Readable by any member, deliberately: a staff member should be able to see
 * who else works here and who to ask for something they cannot do. The writes
 * below are the ones that need a role.
 */
export async function GET(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  return ok(await teamJson(scope.organizationId, scope.user.id, scope.role));
}
