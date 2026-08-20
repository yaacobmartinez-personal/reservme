/**
 * P1-3 verification: the run-sheet transitions do what the day needs.
 *
 *   npm run test:manage
 *
 * check-in / undo, no-show (with the customer flag that drives deposit asks),
 * and cancel freeing the slot.
 */
import postgres from "postgres";
import { expect, it } from "vitest";

const ORG = "org_katipunan";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });
  const {
    reserveSpace,
    markCheckedIn,
    undoCheckIn,
    markNoShow,
    cancelReservation,
  } = await import("../src/lib/booking/reserve");

  const [space] = await sql<{ id: string }[]>`
    SELECT id FROM space WHERE organization_id = ${ORG} ORDER BY sort_order LIMIT 1`;

  const at = (dayOffset: number) => {
    const d = new Date(Date.now() + dayOffset * 86400_000);
    d.setUTCHours(2, 0, 0, 0); // 10:00 Manila
    return d;
  };
  const email = `manage-${Date.now()}@example.com`;
  const ids: string[] = [];

  try {
    /* check-in / undo */
    const a = await reserveSpace({
      organizationId: ORG, spaceId: space.id, startsAt: at(4), endsAt: new Date(at(4).getTime() + 3600_000),
      customer: { name: "Manage A", email },
    });
    ids.push(a.id);

    await markCheckedIn(ORG, a.id);
    let [row] = await sql<{ checked_in_at: Date | null }[]>`SELECT checked_in_at FROM reservation WHERE id = ${a.id}::uuid`;
    check("check-in stamps checked_in_at", row.checked_in_at !== null);

    await undoCheckIn(ORG, a.id);
    [row] = await sql<{ checked_in_at: Date | null }[]>`SELECT checked_in_at FROM reservation WHERE id = ${a.id}::uuid`;
    check("undo clears it", row.checked_in_at === null);

    /* no-show flags the customer */
    const [before] = await sql<{ n: number }[]>`SELECT no_show_count AS n FROM customer WHERE organization_id = ${ORG} AND email = ${email}`;
    await markNoShow(ORG, a.id);
    const [after] = await sql<{ status: string }[]>`SELECT status FROM reservation WHERE id = ${a.id}::uuid`;
    const [cust] = await sql<{ n: number }[]>`SELECT no_show_count AS n FROM customer WHERE organization_id = ${ORG} AND email = ${email}`;
    check("no-show sets status", after.status === "no_show");
    check("no-show bumps the customer's flag", cust.n === before.n + 1, `${before.n} → ${cust.n}`);

    /* a no-show can't be re-marked (only confirmed rows) */
    let reMark = false;
    try { await markNoShow(ORG, a.id); reMark = true; } catch { reMark = false; }
    check("a no-show can't be marked again", !reMark);

    /* cancel frees the slot */
    const slot = { startsAt: at(5), endsAt: new Date(at(5).getTime() + 3600_000) };
    const b = await reserveSpace({ organizationId: ORG, spaceId: space.id, ...slot, customer: { name: "Manage B", email } });
    await cancelReservation(ORG, b.id);
    const c = await reserveSpace({ organizationId: ORG, spaceId: space.id, ...slot, customer: { name: "Manage C", email } });
    ids.push(c.id);
    check("cancelling frees the slot for a new booking", Boolean(c.id) && c.id !== b.id);

    console.log(
      failures === 0
        ? "\nP1-3 verified: the run sheet can run the day.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    for (const id of ids) await sql`DELETE FROM reservation WHERE id = ${id}::uuid`;
    await sql`DELETE FROM reservation WHERE organization_id = ${ORG} AND customer_id IN (SELECT id FROM customer WHERE email = ${email})`;
    await sql`DELETE FROM customer WHERE email = ${email}`;
    await sql.end();
  }
}

it("run-sheet management", async () => {
  await main();
  expect(failures, "one or more checks failed").toBe(0);
}, 30_000);
