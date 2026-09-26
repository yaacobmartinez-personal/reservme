import { sql } from "@/db";
import { availabilityJson, dateProblem } from "@/lib/mobile/public-json";
import { invalid, notFound, ok } from "@/lib/mobile/respond";
import { getVenueBySlug } from "@/lib/venue";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GONE = "We couldn't find that space.";

/**
 * GET /api/public/venues/{slug}/availability?space=&date= — API-CONTRACT #2.
 *
 * The space is checked against the venue in the path before anything is read.
 * Without that, a space id from one venue would answer under another venue's
 * slug — the ids are uuids and unguessable, but "unguessable" is not a
 * permission check.
 *
 * A date outside the venue's horizon is **not** an error: the slots come back
 * marked `too_far_ahead`, which is what the grid draws. Refusing would make
 * the date strip lie about which days exist.
 */
export async function GET(request: Request, { params }: Params) {
  const venue = await getVenueBySlug((await params).slug);
  if (!venue) return notFound("We couldn't find that venue.");

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space");
  const date = url.searchParams.get("date");

  const problem = dateProblem(date);
  if (problem) return invalid({ date: problem }, problem);
  if (!spaceId || !UUID.test(spaceId)) return notFound(GONE);

  const [space] = await sql<{ id: string }[]>`
    SELECT id FROM space
    WHERE id = ${spaceId}::uuid
      AND organization_id = ${venue.organizationId}
      AND is_active = true
  `;
  if (!space) return notFound(GONE);

  return ok(await availabilityJson(venue.organizationId, spaceId, date!));
}
