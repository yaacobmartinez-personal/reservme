import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The run sheet and its stats (docs/API-CONTRACT.md #14, #15).
 *
 * Every rule here is one the web already holds and the phone would break
 * quietly: what counts as "today" for a venue in another timezone, what belongs
 * on the sheet at all, and what a member is told about the person in front of
 * them.
 */

const ORG = "org_today_test";
const TZ = "Pacific/Auckland"; // deliberately not the server's, and not Manila

let sql: postgres.Sql;
let spaceId: string;
let customerId: string;

/** Today at `hour` in the venue's own zone, as an instant. */
function localToday(hour: number) {
  return sql`((now() AT TIME ZONE ${TZ})::date + ${`${hour}:00`}::time) AT TIME ZONE ${TZ}`;
}

async function booking(opts: {
  reference: string;
  status?: string;
  kind?: string;
  hour?: number;
  customer?: boolean;
  amount?: number;
  daysAhead?: number;
}) {
  const {
    reference,
    status = "confirmed",
    kind = "rental",
    hour = 10,
    customer = true,
    amount = 90000,
    daysAhead = 0,
  } = opts;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO reservation (organization_id, space_id, customer_id, reference, kind,
                             status, party_size, amount_cents, starts_at, ends_at,
                             hold_expires_at)
    VALUES (
      ${ORG}, ${spaceId}::uuid, ${customer ? customerId : null}, ${reference}, ${kind},
      ${status}, 2, ${amount},
      ${localToday(hour)} + ${`${daysAhead} days`}::interval,
      ${localToday(hour + 1)} + ${`${daysAhead} days`}::interval,
      ${status === "held" ? sql`now() + interval '15 minutes'` : sql`NULL`}
    )
    RETURNING id
  `;
  return row.id;
}

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  await sql`DELETE FROM organization WHERE id = ${ORG}`;

  await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Today Test', 'today-test')`;
  await sql`INSERT INTO venue (organization_id, timezone) VALUES (${ORG}, ${TZ})`;
  const [space] = await sql<{ id: string }[]>`
    INSERT INTO space (organization_id, name, slug, sort_order, is_active)
    VALUES (${ORG}, 'Court 1', 'court-1', 0, true) RETURNING id
  `;
  spaceId = space.id;
  const [customer] = await sql<{ id: string }[]>`
    INSERT INTO customer (organization_id, name, email, phone, no_show_count)
    VALUES (${ORG}, 'Marites Reyes', 'marites@today.test', '+639170000000', 0)
    RETURNING id
  `;
  customerId = customer.id;
}, 60_000);

afterAll(async () => {
  await sql`DELETE FROM organization WHERE id = ${ORG}`;
  await sql.end();
});

async function clearBookings() {
  await sql`DELETE FROM reservation WHERE organization_id = ${ORG}`;
  await sql`UPDATE customer SET no_show_count = 0 WHERE id = ${customerId}::uuid`;
}

describe("what lands on the run sheet (#14)", () => {
  it("shows today's live bookings, in time order", async () => {
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await booking({ reference: "T-LATE", hour: 16 });
    await booking({ reference: "T-EARLY", hour: 9 });

    const view = await todayView(ORG, TZ);
    expect(view.runSheet.map((r) => r.reference)).toEqual(["T-EARLY", "T-LATE"]);
  });

  it("keeps a block off it, because a block is a closure", async () => {
    // The web's getRunSheet selects kind IN ('rental','session_seat'). Phase 3
    // shipped a seed that modelled a net repair as a session_block reservation
    // and put a "Blocked" row on a sheet that neither the web nor the design
    // has. The filter is the thing that prevents it.
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await booking({ reference: "T-REAL" });
    await booking({ reference: "T-BLOCK", kind: "session_block", customer: false, hour: 14 });

    const view = await todayView(ORG, TZ);
    expect(view.runSheet.map((r) => r.reference)).toEqual(["T-REAL"]);
  });

  it("keeps cancelled and no-show bookings off it", async () => {
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await booking({ reference: "T-OK" });
    await booking({ reference: "T-GONE", status: "cancelled", hour: 11 });
    await booking({ reference: "T-NOPE", status: "no_show", hour: 12 });

    const view = await todayView(ORG, TZ);
    expect(view.runSheet.map((r) => r.reference)).toEqual(["T-OK"]);
  });

  it("keeps a held booking on it — the desk still has to deal with it", async () => {
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await booking({ reference: "T-HELD", status: "held" });

    expect((await todayView(ORG, TZ)).runSheet).toHaveLength(1);
  });

  it("means the venue's today, not the server's", async () => {
    // The whole point of storing a timezone. Auckland is most of a day ahead of
    // a US server; a booking at 09:00 local must be on the sheet regardless.
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await booking({ reference: "T-TODAY", hour: 9 });
    await booking({ reference: "T-TOMORROW", hour: 9, daysAhead: 1 });

    const view = await todayView(ORG, TZ);
    expect(view.runSheet.map((r) => r.reference)).toEqual(["T-TODAY"]);
    expect(view.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [{ expected }] = await sql<{ expected: string }[]>`
      SELECT (now() AT TIME ZONE ${TZ})::date::text AS expected
    `;
    expect(view.date).toBe(expected);
  });
});

describe("what each row tells the desk (#14)", () => {
  it("renders the label as venue-local wall clock, with instants alongside", async () => {
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await booking({ reference: "T-LABEL", hour: 18 });

    const [row] = (await todayView(ORG, TZ)).runSheet;
    // An en dash, as the web renders it.
    expect(row.label).toBe("18:00–19:00");
    // And the raw instants, because the app re-renders them itself rather than
    // trusting a preformatted string it cannot reformat.
    expect(row.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(row.endsAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("carries the customer, their phone and their no-show count", async () => {
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await sql`UPDATE customer SET no_show_count = 3 WHERE id = ${customerId}::uuid`;
    await booking({ reference: "T-WHO" });

    const [row] = (await todayView(ORG, TZ)).runSheet;
    expect(row.customerId).toBe(customerId);
    expect(row.customerName).toBe("Marites Reyes");
    expect(row.customerPhone).toBe("+639170000000");
    expect(row.noShowCount).toBe(3);
  });

  it("flags a first visit, and stops flagging it on the second", async () => {
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await booking({ reference: "T-FIRST" });
    expect((await todayView(ORG, TZ)).runSheet[0].firstVisit).toBe(true);

    await booking({ reference: "T-SECOND", hour: 15 });
    for (const row of (await todayView(ORG, TZ)).runSheet) {
      expect(row.firstVisit, row.reference).toBe(false);
    }
  });

  it("does not count a cancelled booking as a visit", async () => {
    // "2 visits" beside someone who has never turned up is a lie the desk acts
    // on.
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await booking({ reference: "T-VOID", status: "cancelled", hour: 8 });
    await booking({ reference: "T-ONLY" });

    expect((await todayView(ORG, TZ)).runSheet[0].firstVisit).toBe(true);
  });

  it("has no first-visit claim to make about a walk-in with no customer row", async () => {
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await booking({ reference: "T-ANON", customer: false });

    const [row] = (await todayView(ORG, TZ)).runSheet;
    expect(row.customerId).toBeNull();
    expect(row.firstVisit).toBe(false);
  });
});

describe("the stats strip (#14)", () => {
  it("counts today, the checked-in, and what is still ahead", async () => {
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    const id = await booking({ reference: "S-ONE", hour: 9 });
    await booking({ reference: "S-TWO", hour: 11 });
    await booking({ reference: "S-TOMORROW", hour: 9, daysAhead: 1 });
    await sql`UPDATE reservation SET checked_in_at = now() WHERE id = ${id}::uuid`;

    const { stats } = await todayView(ORG, TZ);
    expect(stats.todayCount).toBe(2);
    expect(stats.checkedIn).toBe(1);
    expect(stats.upcomingCount).toBeGreaterThanOrEqual(1);
  });

  it("counts confirmed money only — a hold is not takings", async () => {
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await booking({ reference: "M-PAID", amount: 90000 });
    await booking({ reference: "M-HELD", status: "held", amount: 50000, hour: 13 });

    expect((await todayView(ORG, TZ)).stats.todayRevenueCents).toBe(90000);
  });

  it("counts active spaces apart from total, since the billing band moves with active", async () => {
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    await sql`
      INSERT INTO space (organization_id, name, slug, sort_order, is_active)
      VALUES (${ORG}, 'Court 2', 'court-2', 1, false)
    `;

    const { stats } = await todayView(ORG, TZ);
    expect(stats.totalSpaces).toBe(2);
    expect(stats.activeSpaces).toBe(1);

    await sql`DELETE FROM space WHERE organization_id = ${ORG} AND slug = 'court-2'`;
  });

  it("answers zeroes for a venue with nothing in it, not nulls", async () => {
    const { todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();

    const { stats, runSheet } = await todayView(ORG, TZ);
    expect(runSheet).toEqual([]);
    expect(stats.todayCount).toBe(0);
    expect(stats.todayRevenueCents).toBe(0);
    // A new venue has a space by the time it is live, so this is about the
    // numbers being present rather than the value.
    expect(typeof stats.activeSpaces).toBe("number");
  });
});

describe("one row, for what an action hands back (#15)", () => {
  it("returns the same shape a sheet row has", async () => {
    const { runSheetEntry, todayView } = await import("@/lib/mobile/today-json");
    await clearBookings();
    const id = await booking({ reference: "A-ONE" });

    const [fromSheet] = (await todayView(ORG, TZ)).runSheet;
    const single = await runSheetEntry(ORG, id, TZ);
    expect(single).toEqual(fromSheet);
  });

  it("finds a booking the sheet has dropped, so an action can still answer", async () => {
    // A no-show leaves the sheet, and the action that caused it still has to
    // hand the row back for the app to replace its line with.
    const { runSheetEntry } = await import("@/lib/mobile/today-json");
    await clearBookings();
    const id = await booking({ reference: "A-GONE", status: "no_show" });

    const row = await runSheetEntry(ORG, id, TZ);
    expect(row?.status).toBe("no_show");
  });

  it("is null for a booking belonging to another venue", async () => {
    const { runSheetEntry } = await import("@/lib/mobile/today-json");
    await clearBookings();
    const id = await booking({ reference: "A-MINE" });

    expect(await runSheetEntry("org_someone_else", id, TZ)).toBeNull();
  });
});
