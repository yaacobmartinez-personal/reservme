import { publicVenue } from "@/lib/mobile/public-json";
import { notFound, ok } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/public/venues/{slug} — API-CONTRACT #1. No auth: this is the page
 * a customer reaches from a QR code on a wall.
 *
 * Served on the app host, not the apex. `proxy.ts` passes `/api/*` only on the
 * app and admin hosts, and the app's `SERVER_URL` points at the app host for
 * exactly this reason — the apex is the marketing surface and 404s `/api`.
 */
export async function GET(_request: Request, { params }: Params) {
  const venue = await publicVenue((await params).slug);
  return venue ? ok({ venue }) : notFound("We couldn't find that venue.");
}
