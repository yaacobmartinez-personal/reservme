import { addClosure, closureWindow, reasonProblem } from "@/lib/mobile/space-rules";
import { fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { spaceDetail } from "@/lib/mobile/venue-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/mobile/venues/{slug}/closures — API-CONTRACT #29.
 *
 * The space editor's closure, which is not the calendar's block (#19) even
 * though both write the same table. A block shuts a window of *today* from the
 * grid and any staff member can put one in; a closure here may run across days
 * — a long weekend, a typhoon — and is owner-or-admin, because a venue-wide
 * one takes every space off sale.
 *
 * Like a block, it does not cancel what is already booked. A closure stops
 * *new* bookings; the ones inside the window are the venue's to deal with,
 * and it knows something we do not.
 *
 * `forSpaceId` is the editor that asked, so the answer can be that space —
 * even when the closure itself is venue-wide and belongs to no space.
 */
export async function POST(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  const window = closureWindow(body);
  if (typeof window === "string") return invalid({ to: window }, window);

  const reason = reasonProblem(body.reason);
  if (reason) return invalid({ reason }, reason);

  const spaceId = typeof body.spaceId === "string" && body.spaceId ? body.spaceId : null;
  if (spaceId && !UUID.test(spaceId)) return notFound("We couldn't find that space.");

  const written = await addClosure(
    scope.organizationId,
    scope.timezone,
    spaceId,
    window,
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null,
  );
  if (!written) return notFound("We couldn't find that space.");

  const forSpaceId = typeof body.forSpaceId === "string" ? body.forSpaceId : spaceId;
  if (!forSpaceId || !UUID.test(forSpaceId)) return ok({ ok: true }, 201);

  return ok({ space: await spaceDetail(scope.organizationId, forSpaceId) }, 201);
}
