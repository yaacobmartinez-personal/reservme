import { randomBytes } from "node:crypto";
import { sql } from "@/db";
import { BookingError, isSlotTakenError, withContentionRetry } from "./errors";

/** How long a slot is held while the customer pays. */
export const HOLD_MINUTES = 10;

/** Short, unambiguous, readable over the phone. No 0/O/1/I. */
const ALPHABET = "ACDEFGHJKLMNPQRTUVWXY34789";

function reference(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export type CustomerDetails = {
  name: string;
  email: string;
  phone?: string;
};

export type Reservation = {
  id: string;
  reference: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  amountCents: number;
  holdExpiresAt: Date | null;
};

/**
 * Finds or creates the customer record for this venue. Customers are per-org
 * and never users — no password, no account, and the same email at two venues
 * is two unrelated records.
 */
async function upsertCustomer(
  tx: typeof sql,
  organizationId: string,
  details: CustomerDetails,
): Promise<string> {
  const email = details.email.trim().toLowerCase();
  const name = details.name.trim();
  const phone = details.phone?.trim() || null;

  // Read before writing, and use DO NOTHING rather than DO UPDATE.
  //
  // `ON CONFLICT DO UPDATE` uses speculative insertion and takes a row lock;
  // twenty-odd of them landing on one unique index at once deadlock freely,
  // even though every row is a different customer. Retrying that is treating
  // the symptom. The overwhelmingly common case is a returning customer, which
  // this resolves with a plain SELECT and no write at all.
  return await withContentionRetry(async () => {
    const [existing] = await tx<{ id: string; name: string; phone: string | null }[]>`
      SELECT id, name, phone FROM customer
      WHERE organization_id = ${organizationId} AND email = ${email}
    `;

    if (existing) {
      // Only write when something actually changed, so a regular booking the
      // same court every week costs zero writes here.
      if (existing.name !== name || (phone !== null && existing.phone !== phone)) {
        await tx`
          UPDATE customer
             SET name = ${name}, phone = COALESCE(${phone}, phone)
           WHERE id = ${existing.id}::uuid
        `;
      }
      return existing.id;
    }

    const [inserted] = await tx<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email, phone)
      VALUES (${organizationId}, ${name}, ${email}, ${phone})
      ON CONFLICT (organization_id, email) DO NOTHING
      RETURNING id
    `;

    if (inserted) return inserted.id;

    // Someone else created this customer between our SELECT and INSERT.
    const [raced] = await tx<{ id: string }[]>`
      SELECT id FROM customer
      WHERE organization_id = ${organizationId} AND email = ${email}
    `;
    return raced.id;
  });
}

/**
 * Holds a whole space for a period.
 *
 * There is no "is this slot free?" check before the insert, and adding one
 * would not make this safer — between the check and the write another
 * request can commit. Instead the insert is attempted and Postgres decides:
 * `reservation_no_overlap` lets exactly one of any set of racing writes
 * through and raises 23P01 for the rest, which becomes a clean `slot_taken`.
 */
export async function reserveSpace(input: {
  organizationId: string;
  spaceId: string;
  startsAt: Date;
  endsAt: Date;
  customer: CustomerDetails;
  partySize?: number;
  notes?: string;
}): Promise<Reservation> {
  const {
    organizationId,
    spaceId,
    startsAt,
    endsAt,
    customer,
    partySize = 1,
    notes,
  } = input;

  // Re-derive, on the write, everything the availability read path shows.
  //
  // Availability is a prediction the client is free to ignore or to replay
  // stale: startsAt/endsAt arrive as hidden form fields. The database only
  // enforces *overlap* (reservation_no_overlap); opening hours, notice window,
  // booking horizon, closures, the slot grid and a shared session sitting on
  // the court are enforced here or nowhere. Without this a crafted request
  // holds a slot in the past, at 3am, for thirty days, or over an open-play
  // session — see scripts/_qa.ts, which probes exactly these.
  const [space] = await sql<
    {
      price_cents: number;
      slot_minutes: number;
      is_active: boolean;
      too_soon: boolean;
      too_far: boolean;
      within_hours: boolean;
      closed: boolean;
      session_conflict: boolean;
    }[]
  >`
    SELECT
      s.price_cents,
      s.slot_minutes,
      s.is_active,
      ${startsAt}::timestamptz < now() + make_interval(mins => v.min_notice_minutes) AS too_soon,
      ${startsAt}::timestamptz > now() + make_interval(days => v.max_horizon_days)   AS too_far,
      EXISTS (
        SELECT 1 FROM opening_hours oh
        WHERE oh.space_id = s.id
          AND oh.weekday = EXTRACT(DOW FROM (${startsAt}::timestamptz AT TIME ZONE v.timezone))::smallint
          AND (${startsAt}::timestamptz AT TIME ZONE v.timezone)::time >= oh.opens_at
          AND (${endsAt}::timestamptz   AT TIME ZONE v.timezone)::time <= oh.closes_at
          AND (${startsAt}::timestamptz AT TIME ZONE v.timezone)::date
              = (${endsAt}::timestamptz AT TIME ZONE v.timezone)::date
      ) AS within_hours,
      EXISTS (
        SELECT 1 FROM closure c
        WHERE c.organization_id = s.organization_id
          AND (c.space_id = s.id OR c.space_id IS NULL)
          AND tstzrange(c.starts_at, c.ends_at, '[)')
              && tstzrange(${startsAt}::timestamptz, ${endsAt}::timestamptz, '[)')
      ) AS closed,
      EXISTS (
        SELECT 1 FROM play_session ps
        WHERE ps.space_id = s.id
          AND ps.cancelled = false
          AND tstzrange(ps.starts_at, ps.ends_at, '[)')
              && tstzrange(${startsAt}::timestamptz, ${endsAt}::timestamptz, '[)')
      ) AS session_conflict
    FROM space s
    JOIN venue v ON v.organization_id = s.organization_id
    WHERE s.id = ${spaceId}::uuid AND s.organization_id = ${organizationId}
  `;

  if (!space) throw new BookingError("not_found");
  if (!space.is_active) throw new BookingError("space_inactive");

  const minutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60000);

  // A well-formed slot is exactly one grid step long; anything else (a 7-minute
  // range, a 30-day range, ends before starts) is not something we ever offered.
  if (minutes <= 0 || minutes !== space.slot_minutes) throw new BookingError("bad_slot");
  if (space.closed) throw new BookingError("closed");
  // A rental cannot be sold on top of a shared session's footprint.
  if (space.session_conflict) throw new BookingError("slot_taken");
  if (!space.within_hours) throw new BookingError("outside_hours");
  if (space.too_soon) throw new BookingError("too_soon");
  if (space.too_far) throw new BookingError("too_far_ahead");

  const amountCents = Math.round((space.price_cents * minutes) / space.slot_minutes);

  // Deliberately outside the reservation write. Holding a lock on the customer
  // row while contending for the slot is what turns a lost race into a
  // deadlock; this way the contended write is a single statement. A customer
  // record for someone whose booking then failed is harmless — they did try to
  // book here.
  const customerId = await upsertCustomer(sql, organizationId, customer);

  try {
    return await withContentionRetry(async () =>
      sql.begin(async (tx) => {
        // Serialise writes to this one space before touching the constraint.
        //
        // Exclusion constraints insert the tuple first and only then scan for
        // conflicts, so a burst of concurrent inserts can have each transaction
        // waiting on another's uncommitted row — a genuine deadlock cycle, which
        // Postgres resolves by killing someone with 40P01. That is a dropped
        // question rather than an answer about the slot, and no amount of
        // retrying makes it a clean one.
        //
        // Taking one lock per space, always first and always the same way, means
        // contenders queue instead of colliding: the winner commits and everyone
        // behind gets a decisive 23P01. Different spaces never touch the same
        // lock, so a busy club still books all its courts in parallel.
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${spaceId}, 0))`;

        // Confirmed on the spot, with no expiring hold.
        //
        // A hold only earns its keep when something must happen between choosing
        // a slot and owning it — a card charge, a GCash proof to approve. None of
        // that is wired yet, so a held row here would just expire ten minutes
        // later and quietly un-book a customer who was told they were confirmed.
        // Until a payment tier exists, booking is the confirmation; when one
        // lands this reverts to held + hold_expires_at, with confirmReservation()
        // called on settlement.
        const [row] = await tx<
          {
            id: string;
            reference: string;
            starts_at: Date;
            ends_at: Date;
            status: string;
            amount_cents: number;
            hold_expires_at: Date | null;
          }[]
        >`
        INSERT INTO reservation (
          organization_id, space_id, customer_id, kind, status,
          starts_at, ends_at, party_size, amount_cents, hold_expires_at,
          reference, notes
        )
        VALUES (
          ${organizationId}, ${spaceId}::uuid, ${customerId}::uuid, 'rental', 'confirmed',
          ${startsAt}, ${endsAt}, ${partySize}, ${amountCents},
          NULL,
          ${reference()}, ${notes ?? null}
        )
        RETURNING id, reference, starts_at, ends_at, status, amount_cents, hold_expires_at
      `;

        return {
          id: row.id,
          reference: row.reference,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          status: row.status,
          amountCents: row.amount_cents,
          holdExpiresAt: row.hold_expires_at,
        };
      }),
    );
  } catch (error) {
    if (isSlotTakenError(error)) throw new BookingError("slot_taken");
    throw error;
  }
}

/**
 * Claims per-person spots in a shared session.
 *
 * Exclusion constraints cannot count, so capacity is enforced by an atomic
 * conditional UPDATE. If the guard fails the statement simply affects zero
 * rows — there is no read-modify-write window for two requests to slip
 * through, and no row lock to hold while we think about it.
 */
export async function reserveSessionSeats(input: {
  organizationId: string;
  sessionId: string;
  spots: number;
  customer: CustomerDetails;
}): Promise<Reservation> {
  const { organizationId, sessionId, spots, customer } = input;

  // Same reasoning as reserveSpace: keep the customer write out of the
  // contended transaction.
  const customerId = await upsertCustomer(sql, organizationId, customer);

  return await withContentionRetry(async () =>
    sql.begin(async (tx) => {
      const [claimed] = await tx<
        {
          id: string;
          space_id: string;
          starts_at: Date;
          ends_at: Date;
          price_per_person_cents: number;
        }[]
      >`
        UPDATE play_session
           SET booked_spots = booked_spots + ${spots}
         WHERE id = ${sessionId}::uuid
           AND organization_id = ${organizationId}
           AND cancelled = false
           AND booked_spots + ${spots} <= capacity
        RETURNING id, space_id, starts_at, ends_at, price_per_person_cents
      `;

      // Zero rows means the guard rejected it: full, cancelled, or not ours.
      if (!claimed) throw new BookingError("session_full");

      const [row] = await tx<
        {
          id: string;
          reference: string;
          starts_at: Date;
          ends_at: Date;
          status: string;
          amount_cents: number;
          hold_expires_at: Date | null;
        }[]
      >`
        INSERT INTO reservation (
          organization_id, space_id, session_id, customer_id, kind, status,
          starts_at, ends_at, party_size, amount_cents, hold_expires_at, reference
        )
        VALUES (
          ${organizationId}, ${claimed.space_id}::uuid, ${sessionId}::uuid,
          -- Created 'confirmed', matching reserveSpace. A held session seat
          -- would be swept back to cancelled after HOLD_MINUTES (and its spot
          -- returned) while a payment step that never runs was meant to confirm
          -- it — silently un-booking a customer told they were confirmed. When
          -- a payment tier lands this becomes 'held' + hold_expires_at, with
          -- confirmReservation() called on settlement, same as rentals will.
          ${customerId}::uuid, 'session_seat', 'confirmed',
          ${claimed.starts_at}, ${claimed.ends_at}, ${spots},
          ${claimed.price_per_person_cents * spots},
          NULL,
          ${reference()}
        )
        RETURNING id, reference, starts_at, ends_at, status, amount_cents, hold_expires_at
      `;

      return {
        id: row.id,
        reference: row.reference,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
        amountCents: row.amount_cents,
        holdExpiresAt: row.hold_expires_at,
      };
    }),
  );
}

/** Confirms a held reservation — called once payment is settled or approved. */
export async function confirmReservation(organizationId: string, id: string) {
  const [row] = await sql<{ id: string }[]>`
    UPDATE reservation
       SET status = 'confirmed', hold_expires_at = NULL
     WHERE id = ${id}::uuid
       AND organization_id = ${organizationId}
       AND status = 'held'
    RETURNING id
  `;
  if (!row) throw new BookingError("not_found");
  return row.id;
}

/**
 * Releases expired holds. Runs on a schedule; also called opportunistically
 * before availability reads so a stale hold never outlives its usefulness by
 * more than a request. Session seats give their spots back.
 */
export async function sweepExpiredHolds(): Promise<number> {
  return await sql.begin(async (tx) => {
    const expired = await tx<{ id: string; session_id: string | null; party_size: number }[]>`
      UPDATE reservation
         SET status = 'cancelled', cancelled_at = now()
       WHERE status = 'held' AND hold_expires_at < now()
      RETURNING id, session_id, party_size
    `;

    for (const row of expired) {
      if (!row.session_id) continue;
      await tx`
        UPDATE play_session
           SET booked_spots = GREATEST(0, booked_spots - ${row.party_size})
         WHERE id = ${row.session_id}::uuid
      `;
    }

    return expired.length;
  });
}

/** Cancelling drops the row out of the exclusion constraint, freeing the slot. */
export async function cancelReservation(organizationId: string, id: string) {
  return await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string; session_id: string | null; party_size: number }[]>`
      UPDATE reservation
         SET status = 'cancelled', cancelled_at = now()
       WHERE id = ${id}::uuid
         AND organization_id = ${organizationId}
         AND status IN ('held', 'confirmed')
      RETURNING id, session_id, party_size
    `;

    if (!row) throw new BookingError("not_found");

    if (row.session_id) {
      await tx`
        UPDATE play_session
           SET booked_spots = GREATEST(0, booked_spots - ${row.party_size})
         WHERE id = ${row.session_id}::uuid
      `;
    }

    return row.id;
  });
}

/** Owner marks a booking as arrived. Idempotent; only touches confirmed rows. */
export async function markCheckedIn(organizationId: string, id: string) {
  const [row] = await sql<{ id: string }[]>`
    UPDATE reservation
       SET checked_in_at = now()
     WHERE id = ${id}::uuid
       AND organization_id = ${organizationId}
       AND status = 'confirmed'
    RETURNING id
  `;
  if (!row) throw new BookingError("not_found");
  return row.id;
}

/** Undo an accidental check-in. */
export async function undoCheckIn(organizationId: string, id: string) {
  const [row] = await sql<{ id: string }[]>`
    UPDATE reservation
       SET checked_in_at = NULL
     WHERE id = ${id}::uuid AND organization_id = ${organizationId}
    RETURNING id
  `;
  if (!row) throw new BookingError("not_found");
  return row.id;
}

/**
 * Marks a booking a no-show and flags the customer. The count is what lets a
 * venue decide when to ask a repeat offender for a deposit. The slot's time has
 * passed, so nothing is freed — this is a record, not a release. A session
 * seat's spot is not returned either: the session already ran.
 */
export async function markNoShow(organizationId: string, id: string) {
  return await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string; customer_id: string | null }[]>`
      UPDATE reservation
         SET status = 'no_show'
       WHERE id = ${id}::uuid
         AND organization_id = ${organizationId}
         AND status = 'confirmed'
      RETURNING id, customer_id
    `;

    if (!row) throw new BookingError("not_found");

    if (row.customer_id) {
      await tx`
        UPDATE customer SET no_show_count = no_show_count + 1
         WHERE id = ${row.customer_id}::uuid
      `;
    }

    return row.id;
  });
}
