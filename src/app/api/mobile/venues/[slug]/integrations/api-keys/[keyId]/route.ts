import { revokeApiKey } from "@/lib/api-keys";
import { integrationsJson } from "@/lib/mobile/growth-json";
import { fail, notFound, ok } from "@/lib/mobile/respond";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; keyId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE — API-CONTRACT #46. Revokes; the row stays so its history does. */
export async function DELETE(request: Request, { params }: Params) {
  const { slug, keyId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(keyId)) return notFound("We couldn't find that key.");
  await revokeApiKey(scope.organizationId, keyId);
  return ok(await integrationsJson(scope.organizationId));
}
