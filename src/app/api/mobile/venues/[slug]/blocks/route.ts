import { z } from "zod";
import { sql } from "@/db";
import { blockItem, wallClock } from "@/lib/mobile/calendar-json";
import { fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const schema = z.object({
  // Absent means the whole venue — a public holiday, a typhoon.
  spaceId: z.string().uuid().optional(),
  date: z.string(),
  from: z.string(),
  to: z.string(),
  reason: z.string().trim().max(200).optional(),
});

/**
 * POST /api/mobile/venues/{slug}/blocks — API-CONTRACT #19.
 *
 * Writes a **closure**, never a reservation. That distinction is the reason a
 * block never appears on the run sheet, and it is also why a block does not
 * cancel anything: a closure stops *new* bookings, and the ones already inside
 * the window are the venue's to deal with. The app warns about them and still
 * lets the block through, because the desk knows something we do not.
 */
export async function POST(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid({ date: "Please give a valid range." });
  const input = parsed.data;

  const from = wallClock(input.date, input.from);
  const to = wallClock(input.date, input.to);
  if (!from || !to) return invalid({ from: "Please give a valid start and end." });
  if (input.to <= input.from) {
    return invalid({ to: "The end must be after the start." });
  }

  if (input.spaceId) {
    const [space] = await sql<{ id: string }[]>`
      SELECT id FROM space
      WHERE id = ${input.spaceId}::uuid AND organization_id = ${scope.organizationId}
    `;
    if (!space) return notFound("We couldn't find that space.");
  }

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
    VALUES (
      ${scope.organizationId},
      ${input.spaceId ?? null},
      make_timestamptz(${from.y}, ${from.mo}, ${from.day}, ${from.h}, ${from.mi}, 0, ${scope.timezone}),
      make_timestamptz(${to.y}, ${to.mo}, ${to.day}, ${to.h}, ${to.mi}, 0, ${scope.timezone}),
      ${input.reason ?? null}
    )
    RETURNING id
  `;

  return ok({ block: await blockItem(scope.organizationId, row.id, scope.timezone) }, 201);
}
