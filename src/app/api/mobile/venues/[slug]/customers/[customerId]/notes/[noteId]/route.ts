import { removeNote } from "@/lib/mobile/customer-json";
import { fail, notFound, ok } from "@/lib/mobile/respond";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; customerId: string; noteId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE — API-CONTRACT #22, `deleteCustomerNote`.
 *
 * A note that is already gone answers 404 rather than 200: the app removes the
 * row optimistically, and a silent success on a foreign id would be the same
 * response as a real deletion.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { slug, customerId, noteId } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(customerId) || !UUID.test(noteId)) return notFound("That note is already gone.");

  const removed = await removeNote(scope.organizationId, customerId, noteId);
  return removed ? ok({ ok: true }) : notFound("That note is already gone.");
}
