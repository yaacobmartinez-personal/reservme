/**
 * Verifies customer self-service: the pure cancel-eligibility rule and the
 * token-driven manage/cancel flow against a throwaway venue.
 *
 *   npm run test:selfservice     (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";
import { expect, it } from "vitest";

const ORG = "org_selfserve_test";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { cancelEligibility, getManageableBooking, getBookingForCancel } = await import(
    "../src/lib/booking/manage"
  );
  const { reserveSpace, cancelReservation, moveReservation } = await import(
    "../src/lib/booking/reserve"
  );

  const future = new Date(Date.now() + 48 * 3600_000);
  const soon = new Date(Date.now() + 2 * 3600_000);
  const past = new Date(Date.now() - 3600_000);

  try {
    /* ── pure eligibility ── */
    check("anytime + future → cancellable",
      cancelEligibility("confirmed", future, "anytime", 24).canCancel);
    check("grace + outside window → cancellable",
      cancelEligibility("confirmed", future, "grace", 24).canCancel);
    check("grace + inside window → refused",
      !cancelEligibility("confirmed", soon, "grace", 24).canCancel);
    check("never → refused",
      !cancelEligibility("confirmed", future, "never", 24).canCancel);
    check("past booking → refused",
      !cancelEligibility("confirmed", past, "anytime", 24).canCancel);
    check("already-cancelled → refused",
      !cancelEligibility("cancelled", future, "anytime", 24).canCancel);
    check("no-show → refused",
      !cancelEligibility("no_show", past, "anytime", 24).canCancel);

    /* ── set up a venue ── */
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Self Serve', ${ORG})`;
    await sql`INSERT INTO venue (organization_id, timezone, currency, cancellation_mode, cancellation_grace_hours)
              VALUES (${ORG}, ${TZ}, 'PHP', 'anytime', 24)`;
    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
      VALUES (${ORG}, 'Court 1', 'court-1', 90000, 60, 0) RETURNING id`;
    for (let w = 0; w < 7; w += 1) {
      await sql`INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
                VALUES (${space.id}::uuid, ${w}, '00:00', '23:59')`;
    }
    const at = async (dayOffset: number, hour: number): Promise<Date> => {
      const [r] = await sql<{ t: Date }[]>`
        SELECT (((now() AT TIME ZONE ${TZ})::date + ${dayOffset}::int) + make_time(${hour}::int,0,0))
                 AT TIME ZONE ${TZ} AS t`;
      return r.t;
    };
    const slot = async (dayOffset: number, hour: number) => {
      const s = await at(dayOffset, hour);
      return { startsAt: s, endsAt: new Date(s.getTime() + 3600_000) };
    };

    /* ── book → token → manage ── */
    const s1 = await slot(2, 10);
    const booking = await reserveSpace({
      organizationId: ORG, spaceId: space.id, ...s1,
      customer: { name: "Cara", email: "cara@x.com" },
    });
    const [{ manage_token: token }] = await sql<{ manage_token: string }[]>`
      SELECT manage_token FROM reservation WHERE id = ${booking.id}::uuid`;

    const view = await getManageableBooking(ORG, token);
    check("manage link resolves the booking", view?.reference === booking.reference);
    check("anytime venue → customer may cancel a future booking", view?.cancellation.canCancel === true);

    /* ── unknown / foreign token → null ── */
    check("a random token doesn't resolve", (await getManageableBooking(ORG, crypto.randomUUID())) === null);
    check("a non-uuid token doesn't resolve", (await getManageableBooking(ORG, "nope")) === null);
    check("the token under the wrong slug doesn't resolve", (await getManageableBooking("other-venue", token)) === null);

    /* ── cancel (the action's server-side path) frees the slot ── */
    const forCancel = await getBookingForCancel(ORG, token);
    check("cancel eligibility re-derives true", forCancel?.eligibility.canCancel === true);
    await cancelReservation(forCancel!.organizationId, forCancel!.reservationId);

    const rebook = await reserveSpace({
      organizationId: ORG, spaceId: space.id, ...s1,
      customer: { name: "Dan", email: "dan@x.com" },
    });
    check("cancelling frees the slot to be re-booked", !!rebook.id && rebook.id !== booking.id);

    const afterCancel = await getManageableBooking(ORG, token);
    check("a cancelled booking can't be cancelled again",
      afterCancel?.status === "cancelled" && afterCancel.cancellation.canCancel === false);

    /* ── reschedule (same space, customer policy) ── */
    const s3 = await slot(4, 10);
    const r1 = await reserveSpace({
      organizationId: ORG, spaceId: space.id, ...s3,
      customer: { name: "Fay", email: "fay@x.com" },
    });
    const target = await at(4, 12);
    await moveReservation(ORG, r1.id, space.id, target, { staff: false });
    const [{ h: newHour }] = await sql<{ h: string }[]>`
      SELECT to_char(starts_at AT TIME ZONE ${TZ}, 'HH24') AS h FROM reservation WHERE id = ${r1.id}::uuid`;
    check("reschedule moves the booking to the new time", newHour === "12", newHour);

    const freeOld = await reserveSpace({
      organizationId: ORG, spaceId: space.id, ...s3,
      customer: { name: "Gus", email: "gus@x.com" },
    });
    check("reschedule frees the old slot", !!freeOld.id);

    let clash = false;
    try {
      await moveReservation(ORG, r1.id, space.id, s3.startsAt, { staff: false });
    } catch (e) {
      clash = typeof e === "object" && e !== null && "reason" in e && (e as { reason: string }).reason === "slot_taken";
    }
    check("reschedule onto a taken slot is refused", clash);

    /* ── policy modes on a live future booking ── */
    const s2 = await slot(3, 14);
    const b2 = await reserveSpace({
      organizationId: ORG, spaceId: space.id, ...s2,
      customer: { name: "Eli", email: "eli@x.com" },
    });
    const [{ manage_token: t2 }] = await sql<{ manage_token: string }[]>`
      SELECT manage_token FROM reservation WHERE id = ${b2.id}::uuid`;

    await sql`UPDATE venue SET cancellation_mode='never' WHERE organization_id = ${ORG}`;
    check("never venue → cancel refused", (await getManageableBooking(ORG, t2))?.cancellation.canCancel === false);

    await sql`UPDATE venue SET cancellation_mode='grace', cancellation_grace_hours=24 WHERE organization_id = ${ORG}`;
    check("grace venue, booking 3 days out → cancellable",
      (await getManageableBooking(ORG, t2))?.cancellation.canCancel === true);

    console.log(
      failures === 0
        ? "\nSelf-service verified: eligibility rules, token lookup, policy modes, cancel frees the slot, isolation.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql.end();
  }
}

it("customer self-service", async () => {
  await main();
  expect(failures, "one or more checks failed").toBe(0);
}, 30_000);
