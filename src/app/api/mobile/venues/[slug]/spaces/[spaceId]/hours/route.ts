import { sql } from "@/db";
import { fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { hoursSchema, usableHours } from "@/lib/mobile/space-input";
import { spaceDetail } from "@/lib/mobile/venue-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; spaceId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /api/mobile/venues/{slug}/spaces/{id}/hours — API-CONTRACT #28, and O5.
 *
 * `{hours: [{weekday, opensAt, closesAt}]}` → `{space: SpaceDetail}`.
 *
 * PUT, not PATCH, and the whole week replaces the whole week — because **a
 * closed day is an absent row**, never a row with a flag. That is what
 * `setOpeningHours` writes and what availability reads, and it is the only way
 * to say "Sunday is closed" in this schema. A partial update could never
 * express it.
 *
 * Times are wall clock in the venue's own zone. Storing opening hours as
 * instants breaks silently twice a year wherever the clocks move.
 */
export async function PUT(request: Request, { params }: Params) {
  const { slug, spaceId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(spaceId)) return notFound("We couldn't find that space.");

  const parsed = hoursSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid({ hours: "Use HH:MM for opening and closing times." });

  const rows = usableHours(parsed.data.hours);

  const wrote = await sql.begin(async (tx) => {
    // Ownership folded into the write: the delete only touches rows whose space
    // belongs to this org, so a guessed id changes nothing.
    const removed = await tx<{ space_id: string }[]>`
      DELETE FROM opening_hours
      WHERE space_id = ${spaceId}::uuid
        AND space_id IN (SELECT id FROM space WHERE organization_id = ${scope.organizationId})
      RETURNING space_id
    `;

    const [owned] = await tx<{ id: string }[]>`
      SELECT id FROM space
      WHERE id = ${spaceId}::uuid AND organization_id = ${scope.organizationId}
    `;
    if (!owned) return false;

    for (const row of rows) {
      await tx`
        INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
        VALUES (${spaceId}::uuid, ${row.weekday}, ${row.opensAt}, ${row.closesAt})
      `;
    }
    void removed;
    return true;
  });

  if (!wrote) return notFound("We couldn't find that space.");

  return ok({ space: await spaceDetail(scope.organizationId, spaceId) });
}
