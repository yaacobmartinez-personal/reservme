import { sql } from "@/db";
import { ok, unauthorized } from "@/lib/mobile/respond";
import { mobileUser } from "@/lib/mobile/session";
import { slugProblem } from "@/lib/mobile/venue-input";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/venues/slug-available?slug= — API-CONTRACT #27.
 *
 * → `{slug, available, reason?}`. O3 calls this as the owner types, so the
 * address they are about to print on a poster is checked before they commit
 * to it rather than after.
 *
 * Always 200, even when the answer is no: "that one is taken" is an answer,
 * not a failure, and a 4xx here would show as an error banner over a form the
 * owner is still filling in.
 *
 * It needs a session. The slug space is global and the reply is a membership
 * oracle — without auth this is an endpoint for enumerating which venues
 * exist, at whatever rate you like.
 */
export async function GET(request: Request) {
  const user = await mobileUser(request);
  if (!user) return unauthorized();

  const wanted = (new URL(request.url).searchParams.get("slug") ?? "").trim().toLowerCase();

  const problem = slugProblem(wanted);
  if (problem) return ok({ slug: wanted, available: false, reason: problem });

  // `organization.slug` is the venue's address: one row per venue, globally
  // unique, and what reservme.pro/<slug> resolves.
  const [taken] = await sql<{ id: string }[]>`
    SELECT id FROM "organization" WHERE lower(slug) = ${wanted} LIMIT 1
  `;

  return taken
    ? ok({ slug: wanted, available: false, reason: "Another venue has that address." })
    : ok({ slug: wanted, available: true });
}
