import { sql } from "@/db";
import type { ManageableBooking } from "@/lib/booking/manage";
import { clientIp } from "@/lib/abuse";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The public booking endpoints' shared parts (API-CONTRACT #3–#9): the shape
 * a booking comes back as, and the abuse controls that stand in for Turnstile.
 *
 * ## Why there is no Turnstile here
 *
 * Turnstile is a browser challenge; there is no equivalent an app can run, and
 * shipping one would mean embedding a webview in a booking form. So the app's
 * public writes are protected by rate limits instead, on three buckets:
 *
 * * **by IP**, which catches a script from one machine;
 * * **by venue**, which caps the damage to any one calendar however it arrives;
 * * **by device**, which is the app's own installation id.
 *
 * The first two are the *same buckets the web form uses*, deliberately — one
 * budget per venue, whichever surface the attempt came through, rather than a
 * second allowance that doubles what a venue can absorb.
 *
 * Be clear about what this does not buy: a determined attacker with many IPs
 * and a scripted client is not stopped by any of it, and the device id is
 * self-reported. It stops floods, not a motivated adversary. Play Integrity
 * and App Attest are the real answer if it ever comes to that, and they are
 * not in v1.
 */

// Deliberately generous: they stop floods, not real customers. Shared with the
// web form in `src/app/[venueSlug]/actions.ts`.
const IP_LIMIT = { max: 8, windowSeconds: 300 };
const VENUE_LIMIT = { max: 40, windowSeconds: 300 };
const DEVICE_LIMIT = { max: 10, windowSeconds: 300 };

export const TOO_MANY =
  "Too many booking attempts just now. Please wait a minute and try again.";

/**
 * The app's installation id, from `X-Device-Id`.
 *
 * Self-reported, and treated as such: it is another bucket to spread load
 * across, never an identity. A missing or malformed header simply means the
 * device bucket does not apply, because refusing the booking would punish an
 * older app rather than an attacker.
 */
function deviceId(headers: Headers): string | null {
  const raw = headers.get("x-device-id")?.trim() ?? "";
  return /^[A-Za-z0-9._-]{8,64}$/.test(raw) ? raw : null;
}

export async function withinBookingLimits(
  headers: Headers,
  organizationId: string,
): Promise<boolean> {
  const ip = clientIp(headers);
  const device = deviceId(headers);

  const checks = await Promise.all([
    rateLimit(`book:ip:${ip}`, IP_LIMIT.max, IP_LIMIT.windowSeconds),
    rateLimit(`book:venue:${organizationId}`, VENUE_LIMIT.max, VENUE_LIMIT.windowSeconds),
    ...(device
      ? [rateLimit(`book:device:${device}`, DEVICE_LIMIT.max, DEVICE_LIMIT.windowSeconds)]
      : []),
  ]);

  return checks.every((c) => c.allowed);
}

/**
 * Remembers what an `Idempotency-Key` produced, so a retry after a dropped
 * connection returns the first booking instead of making a second one.
 *
 * Keyed by venue as well as by key: two venues cannot collide, and a key
 * replayed against a different venue is a new request rather than a stolen
 * answer.
 */
export async function replayOf(
  organizationId: string,
  key: string | null,
): Promise<string | null> {
  if (!key) return null;
  const [row] = await sql<{ reservation_id: string }[]>`
    SELECT reservation_id FROM idempotency_key
    WHERE organization_id = ${organizationId} AND key = ${key}
  `;
  return row?.reservation_id ?? null;
}

export async function rememberKey(
  organizationId: string,
  key: string | null,
  reservationId: string,
): Promise<void> {
  if (!key) return;
  await sql`
    INSERT INTO idempotency_key (organization_id, key, reservation_id)
    VALUES (${organizationId}, ${key}, ${reservationId}::uuid)
    ON CONFLICT (organization_id, key) DO NOTHING
  `;
}

export function idempotencyKey(headers: Headers): string | null {
  const raw = headers.get("idempotency-key")?.trim() ?? "";
  return raw.length >= 8 && raw.length <= 128 ? raw : null;
}

/**
 * A booking as the app reads it (#3–#8).
 *
 * `manageToken` is included **only** where the caller already holds it or has
 * just created the booking: it is the capability that stands in for an account,
 * and handing it out anywhere else would turn a booking reference into a way
 * to cancel somebody else's game.
 */
export function bookingJson(
  booking: ManageableBooking,
  opts: { manageToken?: string | null } = {},
) {
  return {
    id: booking.reservationId,
    reference: booking.reference,
    venue: {
      slug: booking.venueSlug,
      name: booking.venueName,
      theme: booking.theme,
      timezone: booking.timezone,
      currency: booking.currency,
      address: booking.address,
    },
    space: {
      id: booking.spaceId,
      name: booking.spaceName,
      kind: booking.spaceKind,
      slotMinutes: booking.slotMinutes,
    },
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    whenLabel: booking.whenLabel,
    kind: booking.kind,
    partySize: booking.partySize,
    amountCents: booking.amountCents,
    status: booking.status,
    checkedInAt: booking.checkedInAt?.toISOString() ?? null,
    notes: booking.notes,
    cancellation: {
      canCancel: booking.cancellation.canCancel,
      reason: booking.cancellation.reason,
    },
    ...(opts.manageToken ? { manageToken: opts.manageToken } : {}),
  };
}

/** The manage token of a reservation we just created, to hand back once. */
export async function manageTokenOf(reservationId: string): Promise<string | null> {
  const [row] = await sql<{ manage_token: string }[]>`
    SELECT manage_token FROM reservation WHERE id = ${reservationId}::uuid
  `;
  return row?.manage_token ?? null;
}
