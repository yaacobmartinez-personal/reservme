import { fail, notFound, ok } from "@/lib/mobile/respond";
import { venueSettings } from "@/lib/mobile/venue-json";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/mobile/venues/{slug}/settings — API-CONTRACT #30.
 *
 * Readable by any member: the booking page's address, policy and GCash name
 * are shown on screens a member uses, and half of it is public on the venue's
 * own page anyway. Changing it is owner/admin — see the PATCH.
 */
export async function GET(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const venue = await venueSettings(scope.organizationId, scope.role);
  return venue ? ok({ venue }) : notFound("We couldn't find that venue.");
}
