import { customerSummaryById, setTags, tagsProblem } from "@/lib/mobile/customer-json";
import { fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; customerId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT — API-CONTRACT #22, the whole tag list at once.
 *
 * The web adds and removes one tag per submit, because each is its own form
 * post. The app edits a chip row and saves it, so the list it sends is the
 * list it means — which also makes the write idempotent: retrying after a
 * dropped connection cannot append a duplicate.
 */
export async function PUT(request: Request, { params }: Params) {
  const { slug, customerId } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(customerId)) return notFound("We couldn't find that customer.");

  const body = (await request.json().catch(() => null)) as { tags?: unknown } | null;
  const problem = tagsProblem(body?.tags);
  if (problem) return invalid({ tags: problem }, problem);

  const changed = await setTags(scope.organizationId, customerId, body!.tags as string[]);
  if (!changed) return notFound("We couldn't find that customer.");

  return ok({ customer: await customerSummaryById(scope.organizationId, customerId, scope.timezone) });
}
