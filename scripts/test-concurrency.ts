/**
 * The test the whole product rests on.
 *
 * "The last slot cannot be sold twice" is the claim on the marketing page and
 * the reason the schema is shaped the way it is. This fires genuinely parallel
 * writes at a single slot and asserts exactly one wins.
 *
 *   npm run test:booking
 */
import postgres from "postgres";
import { BookingError } from "../src/lib/booking/errors";

const ORG_ID = "org_katipunan";
const RACERS = 24;

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // A real pool, so the racers are on separate connections and genuinely
  // concurrent. A single connection would serialise them and prove nothing.
  const sql = postgres(url, { max: RACERS, onnotice: () => {} });
  process.env.DATABASE_URL = url;

  const { reserveSpace, reserveSessionSeats, cancelReservation, sweepExpiredHolds } =
    await import(
    "../src/lib/booking/reserve"
  );

  try {
    const [space] = await sql<{ id: string }[]>`
      SELECT id FROM space WHERE organization_id = ${ORG_ID} ORDER BY sort_order LIMIT 1
    `;
    if (!space) throw new Error("No seeded space — run: npm run db:seed");

    /* ── 1 · N racers, one exclusive slot ──────────────────────── */

    // A slot the venue is genuinely open for. The booking write path enforces
    // opening hours, notice and horizon now — not just overlap — so a valid race
    // needs a valid slot. Katipunan runs 06:00–22:00 Asia/Manila (UTC+8, no DST);
    // 04:00 UTC is 12:00 local, safely mid-day, and two days out clears the
    // 60-minute notice window without approaching the 60-day horizon.
    const startsAt = new Date(Date.now() + 2 * 24 * 3600_000);
    startsAt.setUTCHours(4, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 3600_000);

    await sql`DELETE FROM reservation WHERE space_id = ${space.id}::uuid AND starts_at = ${startsAt}`;

    console.log(`\n${RACERS} concurrent bookings for one slot`);

    const results = await Promise.allSettled(
      Array.from({ length: RACERS }, (_, i) =>
        reserveSpace({
          organizationId: ORG_ID,
          spaceId: space.id,
          startsAt,
          endsAt,
          customer: { name: `Racer ${i}`, email: `racer${i}@example.com` },
        }),
      ),
    );

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    const cleanLosses = lost.filter(
      (r) => r.reason instanceof BookingError && r.reason.reason === "slot_taken",
    );

    // A rejection that isn't a BookingError means the engine broke rather than
    // the race resolving. Surface it — a silent count tells you nothing.
    const unexpected = lost.filter((r) => !(r.reason instanceof BookingError));
    if (unexpected.length) {
      const first = unexpected[0].reason as {
        message?: string;
        code?: string;
        detail?: string;
        query?: string;
      };
      console.log(
        `  ⚠ ${unexpected.length} unexpected error(s). First:\n` +
          `    code: ${first?.code}\n` +
          `    message: ${first?.message}\n` +
          `    detail: ${(first?.detail ?? "-").replace(/\n/g, " ")}\n` +
          `    query: ${(first?.query ?? "-").trim().replace(/\s+/g, " ").slice(0, 120)}`,
      );
    }

    check("exactly one booking succeeds", won.length === 1, `${won.length} succeeded`);
    check(
      `the other ${RACERS - 1} are rejected cleanly, not crashed`,
      cleanLosses.length === lost.length && lost.length === RACERS - 1,
      `${cleanLosses.length}/${lost.length} were slot_taken`,
    );

    const [{ count: liveRows }] = await sql<{ count: string }[]>`
      SELECT count(*)::text FROM reservation
      WHERE space_id = ${space.id}::uuid
        AND starts_at = ${startsAt}
        AND status IN ('held', 'confirmed')
    `;
    check("exactly one live row in the database", liveRows === "1", `${liveRows} rows`);

    /* ── 2 · Overlapping, not identical ────────────────────────── */

    const overlapStart = new Date(startsAt.getTime() + 30 * 60_000);
    let overlapRejected = false;
    try {
      await reserveSpace({
        organizationId: ORG_ID,
        spaceId: space.id,
        startsAt: overlapStart,
        endsAt: new Date(overlapStart.getTime() + 3600_000),
        customer: { name: "Overlapper", email: "overlap@example.com" },
      });
    } catch (error) {
      overlapRejected = error instanceof BookingError && error.reason === "slot_taken";
    }
    check("a half-overlapping booking is refused too", overlapRejected);

    /* ── 3 · Cancelling frees the slot ─────────────────────────── */

    if (won.length !== 1) {
      console.log("\nNo single winner — skipping the remaining checks.\n");
      process.exit(1);
    }

    const winner = (won[0] as PromiseFulfilledResult<{ id: string }>).value;
    await cancelReservation(ORG_ID, winner.id);

    let rebooked = false;
    try {
      const retry = await reserveSpace({
        organizationId: ORG_ID,
        spaceId: space.id,
        startsAt,
        endsAt,
        customer: { name: "Second chance", email: "second@example.com" },
      });
      rebooked = Boolean(retry.id);
      await cancelReservation(ORG_ID, retry.id);
    } catch {
      rebooked = false;
    }
    check("cancelling releases the slot for someone else", rebooked);

    /* ── 4 · Shared session capacity ───────────────────────────── */

    const [session] = await sql<{ id: string; capacity: number }[]>`
      SELECT id, capacity FROM play_session WHERE organization_id = ${ORG_ID} LIMIT 1
    `;

    if (session) {
      await sql`UPDATE play_session SET booked_spots = 0 WHERE id = ${session.id}::uuid`;
      await sql`DELETE FROM reservation WHERE session_id = ${session.id}::uuid`;

      const seatRacers = session.capacity + 6;
      console.log(`\n${seatRacers} people racing for ${session.capacity} session spots`);

      const seats = await Promise.allSettled(
        Array.from({ length: seatRacers }, (_, i) =>
          reserveSessionSeats({
            organizationId: ORG_ID,
            sessionId: session.id,
            spots: 1,
            customer: { name: `Player ${i}`, email: `player${i}@example.com` },
          }),
        ),
      );

      const gotSeat = seats.filter((r) => r.status === "fulfilled").length;
      const turnedAway = seats.filter(
        (r) => r.status === "rejected" && (r.reason as BookingError).reason === "session_full",
      ).length;

      check(
        `exactly ${session.capacity} get a spot`,
        gotSeat === session.capacity,
        `${gotSeat} seated`,
      );
      check(
        "the rest are told it's full",
        turnedAway === seatRacers - session.capacity,
        `${turnedAway} turned away`,
      );

      const [counter] = await sql<{ booked_spots: number; capacity: number }[]>`
        SELECT booked_spots, capacity FROM play_session WHERE id = ${session.id}::uuid
      `;
      check(
        "the counter never exceeds capacity",
        counter.booked_spots <= counter.capacity,
        `${counter.booked_spots}/${counter.capacity}`,
      );

      // Regression guard for P0-2: a session seat must be created 'confirmed',
      // not 'held'. A held seat would be swept back to cancelled here and its
      // spot returned, silently un-booking a customer told they were confirmed.
      const swept = await sweepExpiredHolds();
      const [survivors] = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM reservation
        WHERE session_id = ${session.id}::uuid AND status = 'confirmed'
      `;
      check(
        "session seats survive a hold sweep (not created 'held')",
        Number(survivors.n) === gotSeat && swept === 0,
        `${survivors.n} of ${gotSeat} survived, sweep cancelled ${swept}`,
      );

      await sql`UPDATE play_session SET booked_spots = 9 WHERE id = ${session.id}::uuid`;
      await sql`DELETE FROM reservation WHERE session_id = ${session.id}::uuid`;
    }

    console.log(
      failures === 0
        ? "\nAll checks passed — a slot cannot be sold twice.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql.end();
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
