import { NextResponse } from "next/server";
import { buildIcalFeed, venueByIcalToken } from "@/lib/ical";

export const dynamic = "force-dynamic";

/** Read-only iCal subscription feed. The token in the path is the credential. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const venue = await venueByIcalToken(token);
  if (!venue) return new NextResponse("Not found", { status: 404 });

  const body = await buildIcalFeed(venue.organizationId, venue.name, venue.timezone);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="reservme.ics"',
      "cache-control": "no-store",
    },
  });
}
