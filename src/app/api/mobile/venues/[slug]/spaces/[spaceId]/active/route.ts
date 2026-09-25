import { z } from "zod";
import { sql } from "@/db";
import { fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { spaceSummaries } from "@/lib/mobile/venue-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; spaceId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/mobile/venues/{slug}/spaces/{id}/active — API-CONTRACT #24.
 *
 * `{active}` → `{space: SpaceSummary}`. Owner/admin only, and the refusal is a
 * 403 rather than a hidden control: the billing band is derived from the active
 * space count, so this toggle moves what the venue pays.
 *
 * Pausing is the reversible answer the delete refusal points at — existing
 * bookings are left alone, and only new ones stop.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug, spaceId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(spaceId)) return notFound("We couldn't find that space.");

  const parsed = z
    .object({ active: z.boolean() })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid({ active: "Say whether the space is on sale." });

  const changed = await sql<{ id: string }[]>`
    UPDATE space SET is_active = ${parsed.data.active}
    WHERE id = ${spaceId}::uuid AND organization_id = ${scope.organizationId}
    RETURNING id
  `;
  if (changed.length === 0) return notFound("We couldn't find that space.");

  const space = (await spaceSummaries(scope.organizationId)).find((s) => s.id === spaceId);
  return ok({ space });
}
