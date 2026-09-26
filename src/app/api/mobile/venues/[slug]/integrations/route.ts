import { integrationsJson } from "@/lib/mobile/growth-json";
import { fail, ok } from "@/lib/mobile/respond";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET — API-CONTRACT #46. Owner/admin only: the feed URL and webhook secrets
 * are credentials, and the front desk has no use for them.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  return ok(await integrationsJson(scope.organizationId));
}
