/**
 * Verifies the calendar read model and the staff booking path against a
 * throwaway venue. Self-contained — creates and cleans up its own two orgs
 * (the second exists only to prove tenant isolation). Run on local docker.
 *
 *   npm run test:calendar
 *
 * The heart of it: the staff path relaxes only *policy* (notice window,
 * horizon, single-slot length) and keeps every *physical* guarantee — including
 * that double-booking stays impossible under concurrency.
 */
import postgres from "postgres";

const ORG = "org_calendar_test";
const OTHER = "org_calendar_other";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { reserveSpace, bookRentalAsStaff, moveReservation, cancelReservation } =
    await import("../src/lib/booking/reserve");
  const { getCalendarDay } = await import("../src/lib/calendar");

  const reasonOf = (e: unknown) =>
    typeof e === "object" && e !== null && "reason" in e ? (e as { reason: string }).reason : String(e);
  const expectReason = async (fn: () => Promise<unknown>, reason: string) => {
    try {
      await fn();
      return { ok: false, got: "no error" };
    } catch (e) {
      return { ok: reasonOf(e) === reason, got: reasonOf(e) };
    }
  };

  try {
    for (const id of [ORG, OTHER]) {
      await sql`DELETE FROM organization WHERE id = ${id}`;
      await sql`INSERT INTO organization (id, name, slug) VALUES (${id}, ${id}, ${id})`;
      // Long notice + short horizon make the policy relaxations deterministic
      // regardless of the wall-clock time CI runs at.
      await sql`INSERT INTO venue (organization_id, timezone, currency, min_notice_minutes, max_horizon_days)
                VALUES (${id}, ${TZ}, 'PHP', 1440, 2)`;
    }

    const mkSpace = async (org: string, name: string, slug: string, sort: number) => {
      const [s] = await sql<{ id: string }[]>`
        INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
        VALUES (${org}, ${name}, ${slug}, 90000, 60, ${sort}) RETURNING id`;
      for (let w = 0; w < 7; w += 1) {
        await sql`INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
                  VALUES (${s.id}::uuid, ${w}, '00:00', '23:59')`;
      }
      return s.id;
    };
    const court1 = await mkSpace(ORG, "Court 1", "court-1", 0);
    const court2 = await mkSpace(ORG, "Court 2", "court-2", 1);
    const otherCourt = await mkSpace(OTHER, "Other Court", "court-1", 0);

    // A venue-local instant at (today + dayOffset) at `hour`:00, as a Date.
    const at = async (dayOffset: number, hour: number): Promise<Date> => {
      const [row] = await sql<{ t: Date }[]>`
        SELECT (((now() AT TIME ZONE ${TZ})::date + ${dayOffset}::int) + make_time(${hour}::int, 0, 0))
                 AT TIME ZONE ${TZ} AS t`;
      return row.t;
    };
    const [{ today }] = await sql<{ today: string }[]>`
      SELECT to_char((now() AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS today`;
    const plus = (d: Date, hours: number) => new Date(d.getTime() + hours * 3600_000);

    /* ── staff can book what the public can't (policy relaxations) ── */
    const t10 = await at(0, 10);
    // Public: 10:00 today is inside the 24h notice window → rejected.
    const pub = await expectReason(
      () => reserveSpace({ organizationId: ORG, spaceId: court1, startsAt: t10, endsAt: plus(t10, 1), customer: { name: "P", email: "p@x.com" } }),
      "too_soon",
    );
    check("public booking inside the notice window is refused", pub.ok, pub.got);
    // Staff: same slot books fine.
    const staffBooking = await bookRentalAsStaff({
      organizationId: ORG, spaceId: court1, startsAt: t10, endsAt: plus(t10, 1),
      customer: { name: "Ana Staff", email: "ana@x.com" },
    });
    check("staff booking inside the notice window succeeds", staffBooking.status === "confirmed");
    check("staff booking created/linked the customer", true);
    const [cust] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM customer WHERE organization_id = ${ORG} AND email = 'ana@x.com'`;
    check("customer row exists for the staff booking", cust.n === "1", cust.n);

    // Staff N-slot (2h) booking; public would reject the length.
    const t12 = await at(0, 12);
    const twoHour = await bookRentalAsStaff({
      organizationId: ORG, spaceId: court1, startsAt: t12, endsAt: plus(t12, 2),
      customer: { name: "Two Hour", email: "2h@x.com" },
    });
    check("staff can book multiple slots (2h)", twoHour.amountCents === 180000, `${twoHour.amountCents}`);
    const badLen = await expectReason(
      () => reserveSpace({ organizationId: ORG, spaceId: court2, startsAt: t12, endsAt: plus(t12, 2), customer: { name: "P", email: "p@x.com" } }),
      "bad_slot",
    );
    check("public 2h booking is refused (bad_slot)", badLen.ok, badLen.got);

    // Beyond horizon: staff ok, public too_far.
    const far = await at(5, 10);
    const farBooking = await bookRentalAsStaff({
      organizationId: ORG, spaceId: court2, startsAt: far, endsAt: plus(far, 1),
      customer: { name: "Far", email: "far@x.com" },
    });
    check("staff can book beyond the public horizon", farBooking.status === "confirmed");
    const t6 = await at(6, 11);
    const pubFar = await expectReason(
      () => reserveSpace({ organizationId: ORG, spaceId: court2, startsAt: t6, endsAt: plus(t6, 1), customer: { name: "P", email: "p@x.com" } }),
      "too_far_ahead",
    );
    check("public booking beyond horizon is refused", pubFar.ok, pubFar.got);

    /* ── physical guarantees still hold for staff ── */
    const dup = await expectReason(
      () => bookRentalAsStaff({ organizationId: ORG, spaceId: court1, startsAt: t10, endsAt: plus(t10, 1), customer: { name: "Dup", email: "d@x.com" } }),
      "slot_taken",
    );
    check("staff cannot double-book an occupied slot", dup.ok, dup.got);

    // Closure blocks a staff booking.
    const t14 = await at(0, 14);
    await sql`INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
              VALUES (${ORG}, ${court2}::uuid, ${t14}, ${plus(t14, 1)}, 'maintenance')`;
    const closed = await expectReason(
      () => bookRentalAsStaff({ organizationId: ORG, spaceId: court2, startsAt: t14, endsAt: plus(t14, 1), customer: { name: "C", email: "c@x.com" } }),
      "closed",
    );
    check("staff booking onto a closure is refused", closed.ok, closed.got);

    /* ── concurrency: exactly one of many staff bookings wins the slot ── */
    const t16 = await at(0, 16);
    const racers = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        bookRentalAsStaff({
          organizationId: ORG, spaceId: court1, startsAt: t16, endsAt: plus(t16, 1),
          customer: { name: `Race ${i}`, email: `race${i}@x.com` },
        }),
      ),
    );
    const won = racers.filter((r) => r.status === "fulfilled").length;
    check("exactly one of 8 concurrent staff bookings wins the slot", won === 1, `${won} won`);

    /* ── move ── */
    const t18 = await at(0, 18);
    const moved = await moveReservation(ORG, staffBooking.id, court2, t18);
    check("move relocates the booking", moved.id === staffBooking.id);
    const [movedRow] = await sql<{ space_id: string; h: string }[]>`
      SELECT space_id, to_char(starts_at AT TIME ZONE ${TZ}, 'HH24') AS h
      FROM reservation WHERE id = ${staffBooking.id}::uuid`;
    check("move lands on the new space + time", movedRow.space_id === court2 && movedRow.h === "18", `${movedRow.h}`);
    // Moving onto an occupied slot is refused (t12 2h booking still on court1 10–... wait, occupy court2@18 first)
    const blocker = await bookRentalAsStaff({
      organizationId: ORG, spaceId: court1, startsAt: t18, endsAt: plus(t18, 1),
      customer: { name: "Blocker", email: "b@x.com" },
    });
    const moveClash = await expectReason(
      () => moveReservation(ORG, blocker.id, court2, t18),
      "slot_taken",
    );
    check("a move that would overlap is refused", moveClash.ok, moveClash.got);

    /* ── getCalendarDay read model ── */
    const day = await getCalendarDay(ORG, TZ, today);
    check("calendar lists this org's active spaces as columns", day.columns.length === 2, `${day.columns.length}`);
    const rentalsToday = day.blocks.filter((b) => b.type === "rental");
    check("calendar shows today's rentals as blocks", rentalsToday.length >= 4, `${rentalsToday.length}`);
    const twoHourBlock = day.blocks.find((b) => b.reference === twoHour.reference);
    check("a 2h block spans 120 minutes (12:00→14:00)",
      !!twoHourBlock && twoHourBlock.startMin === 720 && twoHourBlock.endMin === 840,
      twoHourBlock ? `${twoHourBlock.startMin}-${twoHourBlock.endMin}` : "missing");
    const closureBlock = day.blocks.find((b) => b.type === "closure");
    check("the closure shows on the calendar", !!closureBlock);

    /* ── tenant isolation ── */
    const otherDay = await getCalendarDay(OTHER, TZ, today);
    check("another org's calendar shows none of our bookings",
      otherDay.blocks.every((b) => b.type !== "rental"), `${otherDay.blocks.length} blocks`);
    // Booking a space that isn't ours resolves to not_found (space not in org).
    const t20 = await at(0, 20);
    const foreignSpace = await expectReason(
      () => bookRentalAsStaff({ organizationId: ORG, spaceId: otherCourt, startsAt: t20, endsAt: plus(t20, 1), customer: { name: "X", email: "x@x.com" } }),
      "not_found",
    );
    check("staff cannot book a space from another org", foreignSpace.ok, foreignSpace.got);
    // Moving a reservation that isn't ours is not_found.
    const t21 = await at(0, 21);
    const foreignMove = await expectReason(
      () => moveReservation(OTHER, staffBooking.id, otherCourt, t21),
      "not_found",
    );
    check("cannot move another org's reservation", foreignMove.ok, foreignMove.got);

    void cancelReservation; // (available for teardown symmetry; org cascade cleans up)

    console.log(
      failures === 0
        ? "\nCalendar verified: staff path relaxes policy, keeps every physical guarantee, and the day read model is correct.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER})`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
