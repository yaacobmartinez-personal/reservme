import { removeClosure } from "@/lib/mobile/space-rules";
import { fail, notFound, ok } from "@/lib/mobile/respond";
import { spaceDetail } from "@/lib/mobile/venue-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; closureId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GONE = "That closure is already gone.";

/**
 * DELETE — API-CONTRACT #29.
 *
 * `forSpaceId` rides in the query rather than a body: a DELETE body is legal
 * and quietly dropped by enough proxies that it is not worth depending on.
 * Without it the answer is a bare `{ok:true}`, which is all the caller needs
 * when it was not looking at a space.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { slug, closureId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(closureId)) return notFound(GONE);

  const removed = await removeClosure(scope.organizationId, closureId);
  if (!removed) return notFound(GONE);

  const forSpaceId = new URL(request.url).searchParams.get("forSpaceId");
  if (!forSpaceId || !UUID.test(forSpaceId)) return ok({ ok: true });

  return ok({ space: await spaceDetail(scope.organizationId, forSpaceId) });
}
