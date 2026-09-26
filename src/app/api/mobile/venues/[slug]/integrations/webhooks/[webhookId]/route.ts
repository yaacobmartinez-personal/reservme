import { integrationsJson } from "@/lib/mobile/growth-json";
import { fail, notFound, ok } from "@/lib/mobile/respond";
import { deleteWebhook } from "@/lib/webhooks";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; webhookId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE — API-CONTRACT #46. */
export async function DELETE(request: Request, { params }: Params) {
  const { slug, webhookId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(webhookId)) return notFound("We couldn't find that webhook.");
  await deleteWebhook(scope.organizationId, webhookId);
  return ok(await integrationsJson(scope.organizationId));
}
