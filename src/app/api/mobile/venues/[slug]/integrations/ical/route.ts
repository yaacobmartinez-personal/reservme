import { rotateIcalToken } from "@/lib/ical";
import { integrationsJson } from "@/lib/mobile/growth-json";
import { fail, ok } from "@/lib/mobile/respond";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * POST — API-CONTRACT #46. A new calendar-feed URL; every calendar subscribed
 * with the old one stops updating. That is how a leaked link is shut off.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  await rotateIcalToken(scope.organizationId);
  return ok(await integrationsJson(scope.organizationId));
}
