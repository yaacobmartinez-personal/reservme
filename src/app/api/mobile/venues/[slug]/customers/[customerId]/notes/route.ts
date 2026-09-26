import { addNote, noteProblem } from "@/lib/mobile/customer-json";
import { fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; customerId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST — API-CONTRACT #22, `addCustomerNote`.
 *
 * Any staff member may write one. Notes are the desk's own memory — "prefers
 * court 2", "pays in cash" — and gating them on a role would mean the person
 * actually standing at the counter is the one who cannot record it.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug, customerId } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(customerId)) return notFound("We couldn't find that customer.");

  const body = (await request.json().catch(() => null)) as { body?: unknown } | null;
  const problem = noteProblem(body?.body);
  if (problem) return invalid({ body: problem }, problem);

  const note = await addNote(
    scope.organizationId,
    customerId,
    scope.user.id,
    body!.body as string,
  );
  if (!note) return notFound("We couldn't find that customer.");

  return ok({ note: { ...note, authorName: scope.user.name } }, 201);
}
