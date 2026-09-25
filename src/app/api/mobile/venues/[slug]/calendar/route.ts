import { calendarDay } from "@/lib/mobile/calendar-json";
import { fail, invalid, ok } from "@/lib/mobile/respond";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/mobile/venues/{slug}/calendar?date=YYYY-MM-DD — API-CONTRACT #16.
 *
 * → `{date, rows, lanes}`. The date is venue-local, because that is the day the
 * desk is looking at; passing an instant would make "today" ambiguous for
 * exactly the venues this is built for.
 *
 * No date defaults to the venue's today rather than the server's.
 */
export async function GET(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const asked = new URL(request.url).searchParams.get("date");
  if (asked && !/^\d{4}-\d{2}-\d{2}$/.test(asked)) {
    return invalid({ date: "Use YYYY-MM-DD." });
  }

  const date = asked ?? (await venueToday(scope.organizationId, scope.timezone));
  return ok(await calendarDay(scope.organizationId, scope.timezone, date));
}

async function venueToday(_organizationId: string, timezone: string) {
  const { sql } = await import("@/db");
  const [row] = await sql<{ today: string }[]>`
    SELECT (now() AT TIME ZONE ${timezone})::date::text AS today
  `;
  return row.today;
}
