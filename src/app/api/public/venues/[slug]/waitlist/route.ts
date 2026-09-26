import { z } from "zod";
import { sql } from "@/db";
import { joinWaitlist } from "@/lib/booking/waitlist";
import { clientIp } from "@/lib/abuse";
import { invalid, notFound, ok, rateLimited } from "@/lib/mobile/respond";
import { rateLimit } from "@/lib/rate-limit";
import { getVenueBySlug } from "@/lib/venue";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const schema = z.object({
  spaceId: z.string().uuid(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  name: z.string().trim().min(1, "Please give a name."),
  email: z.string().trim().email("Please give an email we can reach you on."),
  phone: z.string().trim().max(40).optional(),
});

/**
 * POST /api/public/venues/{slug}/waitlist — API-CONTRACT #9.
 *
 * Joining is **not** a hold. It is a request to be emailed if the slot frees,
 * and whoever books first keeps it — which is what protects the
 * no-double-booking guarantee: a waiter goes through the same reserve path as
 * anybody else.
 *
 * Joining twice is a no-op rather than an error: `joinWaitlist` dedupes on
 * (space, slot, customer), so a customer tapping again is told they are on the
 * list, not scolded for it.
 *
 * A suspended venue still accepts these, deliberately: the queue is for when
 * the venue is taking bookings again, and refusing would lose the interest.
 */
export async function POST(request: Request, { params }: Params) {
  const venue = await getVenueBySlug((await params).slug);
  if (!venue) return notFound("We couldn't find that venue.");

  const limit = await rateLimit(`waitlist:ip:${clientIp(request.headers)}`, 10, 300);
  if (!limit.allowed) {
    return rateLimited("Too many attempts — please try again in a minute.");
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid({ [String(issue.path[0] ?? "email")]: issue.message }, issue.message);
  }
  const input = parsed.data;

  // The space is checked against this venue: the id selects among its spaces,
  // it does not name one.
  const [space] = await sql<{ id: string }[]>`
    SELECT id FROM space
    WHERE id = ${input.spaceId}::uuid
      AND organization_id = ${venue.organizationId}
      AND is_active = true
  `;
  if (!space) return notFound("We couldn't find that space.");

  const { already } = await joinWaitlist({
    organizationId: venue.organizationId,
    spaceId: input.spaceId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    customer: { name: input.name, email: input.email, phone: input.phone },
  });

  // `already` is reported rather than hidden, so the screen can say "you're
  // already on the list" instead of implying a second place in a queue.
  return ok({ ok: true, already }, 201);
}
