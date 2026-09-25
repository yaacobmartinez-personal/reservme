import { sql } from "@/db";
import { fail, invalid, ok } from "@/lib/mobile/respond";
import { spaceSchema, uniqueSpaceSlug } from "@/lib/mobile/space-input";
import { spaceDetail, spaceSummaries } from "@/lib/mobile/venue-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** GET /api/mobile/venues/{slug}/spaces — API-CONTRACT #24. */
export async function GET(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  return ok({ spaces: await spaceSummaries(scope.organizationId) });
}

/**
 * POST /api/mobile/venues/{slug}/spaces — API-CONTRACT #28, and O4.
 *
 * → `201 {space: SpaceDetail}`.
 *
 * The new space gets a full week of 08:00–22:00. That is `createSpace`'s own
 * behaviour and it matters: a space with no opening hours is unbookable, so
 * adding one and having it take no bookings would defeat the point. O5 then
 * narrows the week, and the editor can close any day by leaving its row out.
 */
export async function POST(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const parsed = spaceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid({ [String(issue.path[0] ?? "name")]: issue.message }, issue.message);
  }

  const input = parsed.data;
  const slug = await uniqueSpaceSlug(scope.organizationId, input.name);

  const id = await sql.begin(async (tx) => {
    const [{ next }] = await tx<{ next: number }[]>`
      SELECT COALESCE(max(sort_order) + 1, 0) AS next
      FROM space WHERE organization_id = ${scope.organizationId}
    `;

    const [space] = await tx<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, kind, capacity,
                         slot_minutes, buffer_minutes, price_cents, sort_order)
      VALUES (${scope.organizationId}, ${input.name}, ${slug}, ${input.kind},
              ${input.capacity}, ${input.slotMinutes}, ${input.bufferMinutes},
              ${input.priceCents}, ${next})
      RETURNING id
    `;

    for (let weekday = 0; weekday < 7; weekday += 1) {
      await tx`
        INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
        VALUES (${space.id}::uuid, ${weekday}, '08:00', '22:00')
      `;
    }
    return space.id;
  });

  return ok({ space: await spaceDetail(scope.organizationId, id) }, 201);
}
