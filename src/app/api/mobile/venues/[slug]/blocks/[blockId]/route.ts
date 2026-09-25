import { sql } from "@/db";
import { fail, notFound, ok } from "@/lib/mobile/respond";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; blockId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/mobile/venues/{slug}/blocks/{id} — API-CONTRACT #19.
 *
 * Lifting a block reopens the window for new bookings. Nothing is restored,
 * because nothing was cancelled when it went in.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { slug, blockId } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(blockId)) return notFound("We couldn't find that block.");

  const removed = await sql<{ id: string }[]>`
    DELETE FROM closure
    WHERE id = ${blockId}::uuid AND organization_id = ${scope.organizationId}
    RETURNING id
  `;
  return removed.length > 0 ? ok({ ok: true }) : notFound("We couldn't find that block.");
}
