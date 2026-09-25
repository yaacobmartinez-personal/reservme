import { z } from "zod";
import { sql } from "@/db";
import { auth } from "@/lib/auth";
import { captureException } from "@/lib/observability";
import { conflict, fail, invalid, ok, unauthorized } from "@/lib/mobile/respond";
import { membershipsFor, mobileUser } from "@/lib/mobile/session";
import { venueProblem } from "@/lib/mobile/venue-input";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string(),
  slug: z.string(),
  timezone: z.string().default("Asia/Manila"),
  currency: z.string().default("PHP"),
  address: z.string().optional(),
});

/**
 * POST /api/mobile/venues — API-CONTRACT #27.
 *
 * `{name, slug, timezone, currency, address?}` → `201 {venue: VenueMembership}`,
 * the venue live and on a one-month trial. This is O3, and it is the step that
 * turns an account into something that can take a booking.
 *
 * Three rows have to exist afterwards or the venue is broken in a way the
 * owner cannot see: the organisation (Better Auth's, which also makes them its
 * owner), our `venue` row carrying timezone and policy, and a `subscription`
 * so billing has something to read. The org comes from the plugin and cannot
 * join our transaction, so the other two go in together and the org is rolled
 * back by hand if they fail. A half-made venue is worse than none: it would
 * show in the picker and fall over on every screen.
 */
export async function POST(request: Request) {
  const user = await mobileUser(request);
  if (!user) return unauthorized();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid({ name: "Give your venue a name." });

  const input = {
    name: parsed.data.name.trim(),
    slug: parsed.data.slug.trim().toLowerCase(),
    timezone: parsed.data.timezone.trim(),
    currency: parsed.data.currency.trim().toUpperCase(),
    address: parsed.data.address?.trim() || undefined,
  };

  const problem = venueProblem(input);
  if (problem) return invalid({ [problem.field]: problem.message }, problem.message);

  // Already theirs? Hand it back rather than refusing. The app retries a failed
  // POST with the same Idempotency-Key, and an owner who taps twice on a slow
  // connection should not be told their own venue's address is taken.
  const mine = (await membershipsFor(user.id)).find((v) => v.slug.toLowerCase() === input.slug);
  if (mine) return ok({ venue: mine }, 201);

  const [taken] = await sql<{ id: string }[]>`
    SELECT id FROM "organization" WHERE lower(slug) = ${input.slug} LIMIT 1
  `;
  if (taken) {
    return conflict("slug_taken", "Another venue has that address.", {
      fieldErrors: { slug: "Another venue has that address." },
    });
  }

  let organizationId: string | null = null;
  try {
    const org = await auth.api.createOrganization({
      body: { name: input.name, slug: input.slug },
      headers: request.headers,
    });
    if (!org?.id) throw new Error("createOrganization returned no organisation");
    organizationId = org.id;

    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO venue (organization_id, timezone, currency, address)
        VALUES (${org.id}, ${input.timezone}, ${input.currency}, ${input.address ?? null})
      `;
      // The free month starts now, matching /api/venue/init and what the
      // billing screen counts down.
      await tx`
        INSERT INTO subscription (organization_id, status, trial_ends_at)
        VALUES (${org.id}, 'trialing', now() + interval '1 month')
      `;
    });
  } catch (error) {
    if (organizationId) {
      // The org exists but has no venue behind it. Leaving it would hold the
      // slug forever and put a venue in the picker that every screen 500s on.
      await sql`DELETE FROM "organization" WHERE id = ${organizationId}`.catch(() => {});
    }
    captureException(error, { where: "mobile.venues.create", userId: user.id });
    return fail(500, {
      error: "server_error",
      message: "We couldn't create that venue. Try again.",
    });
  }

  const venue = (await membershipsFor(user.id)).find((v) => v.orgId === organizationId);
  if (!venue) {
    return fail(500, {
      error: "server_error",
      message: "Venue created, but we couldn't read it back. Sign in again.",
    });
  }

  return ok({ venue }, 201);
}
