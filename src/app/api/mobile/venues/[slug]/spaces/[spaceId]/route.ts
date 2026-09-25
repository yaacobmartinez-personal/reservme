import { sql } from "@/db";
import { conflict, fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { spaceSchema } from "@/lib/mobile/space-input";
import { spaceDetail } from "@/lib/mobile/venue-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; spaceId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/mobile/venues/{slug}/spaces/{id} — the editor's own read (#28). */
export async function GET(request: Request, { params }: Params) {
  const { slug, spaceId } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(spaceId)) return notFound("We couldn't find that space.");

  const space = await spaceDetail(scope.organizationId, spaceId);
  return space ? ok({ space }) : notFound("We couldn't find that space.");
}

/** PATCH … — the editor's basics, saved as one write (#28). */
export async function PATCH(request: Request, { params }: Params) {
  const { slug, spaceId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(spaceId)) return notFound("We couldn't find that space.");

  const parsed = spaceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid({ [String(issue.path[0] ?? "name")]: issue.message }, issue.message);
  }
  const input = parsed.data;

  // The slug is deliberately NOT recomputed from a renamed space: it is in
  // share links the owner may already have sent, and a rename should not
  // quietly break them.
  const changed = await sql<{ id: string }[]>`
    UPDATE space
       SET name = ${input.name}, kind = ${input.kind}, capacity = ${input.capacity},
           slot_minutes = ${input.slotMinutes}, buffer_minutes = ${input.bufferMinutes},
           price_cents = ${input.priceCents}
     WHERE id = ${spaceId}::uuid AND organization_id = ${scope.organizationId}
     RETURNING id
  `;
  if (changed.length === 0) return notFound("We couldn't find that space.");

  return ok({ space: await spaceDetail(scope.organizationId, spaceId) });
}

/**
 * DELETE … — refused while bookings are still ahead (#28).
 *
 * Deleting would strand the customers holding them, and the space's rows
 * cascade, so there is no undo. Pausing is the reversible answer and the editor
 * offers it instead — same wording as the app's own fake, so the refusal reads
 * identically whichever side produced it.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { slug, spaceId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(spaceId)) return notFound("We couldn't find that space.");

  const [space] = await sql<{ id: string }[]>`
    SELECT id FROM space
    WHERE id = ${spaceId}::uuid AND organization_id = ${scope.organizationId}
  `;
  if (!space) return notFound("We couldn't find that space.");

  const [{ ahead }] = await sql<{ ahead: number }[]>`
    SELECT count(*)::int AS ahead
    FROM reservation
    WHERE space_id = ${spaceId}::uuid
      AND status IN ('held', 'confirmed')
      AND kind IN ('rental', 'session_seat')
      AND starts_at > now()
  `;

  if (ahead > 0) {
    return conflict(
      "has_bookings",
      ahead === 1
        ? "One booking is still ahead on this space. Pause it instead."
        : `${ahead} bookings are still ahead on this space. Pause it instead.`,
      { upcomingBookings: ahead },
    );
  }

  await sql`
    DELETE FROM space
    WHERE id = ${spaceId}::uuid AND organization_id = ${scope.organizationId}
  `;
  return ok({ ok: true });
}
