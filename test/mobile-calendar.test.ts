import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The day grid (docs/API-CONTRACT.md #16, #19).
 *
 * The web positions a flat list of blocks by minute offset; the app draws a
 * lane per space and needs the hour rows named. This is the mapping between
 * those two ways of drawing the same day, so what it has to get right is where
 * things land — not what is on the day, which `getCalendarDay` already decides.
 */

const ORG = "org_cal_test";
const TZ = "Asia/Manila";

let sql: postgres.Sql;
let courtA: string;
let courtB: string;
let customerId: string;
let date: string;

async function localDate(offsetDays: number) {
  const [row] = await sql<{ d: string }[]>`
    SELECT ((now() AT TIME ZONE ${TZ})::date + ${offsetDays}::int)::text AS d
  `;
  return row.d;
}

async function instant(day: string, time: string) {
  const [row] = await sql<{ at: Date }[]>`
    SELECT (${day}::date + ${time}::time) AT TIME ZONE ${TZ} AS at
  `;
  return row.at;
}

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  await sql`DELETE FROM organization WHERE id = ${ORG}`;

  await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Cal Test', 'cal-test')`;
  await sql`INSERT INTO venue (organization_id, timezone) VALUES (${ORG}, ${TZ})`;

  for (const [i, name] of ["Court A", "Court B"].entries()) {
    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, slot_minutes, sort_order, is_active)
      VALUES (${ORG}, ${name}, ${`court-${i}`}, ${i === 0 ? 60 : 30}, ${i}, true)
      RETURNING id
    `;
    if (i === 0) courtA = space.id;
    else courtB = space.id;
    for (let weekday = 0; weekday < 7; weekday += 1) {
      await sql`
        INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
        VALUES (${space.id}::uuid, ${weekday}, '08:00', '22:00')
      `;
    }
  }

  const [customer] = await sql<{ id: string }[]>`
    INSERT INTO customer (organization_id, name, email)
    VALUES (${ORG}, 'Ramon Cruz', 'ramon@cal.test') RETURNING id
  `;
  customerId = customer.id;
  date = await localDate(2);
}, 60_000);

afterAll(async () => {
  await sql`DELETE FROM organization WHERE id = ${ORG}`;
  await sql.end();
});

async function clear() {
  await sql`DELETE FROM closure WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM reservation WHERE organization_id = ${ORG}`;
}

describe("the grid itself (#16)", () => {
  it("draws a lane per active space, in sort order", async () => {
    const { calendarDay } = await import("@/lib/mobile/calendar-json");
    await clear();

    const day = await calendarDay(ORG, TZ, date);
    expect(day.lanes.map((l) => l.spaceName)).toEqual(["Court A", "Court B"]);
    expect(day.date).toBe(date);
  });

  it("carries each lane's own slot length, not one for the venue", async () => {
    // "2 slots" on a 30-minute space is an hour, and on a 60-minute space two.
    // A single venue-wide number would make the sheet lie on one of them.
    const { calendarDay } = await import("@/lib/mobile/calendar-json");
    const day = await calendarDay(ORG, TZ, date);
    expect(day.lanes.find((l) => l.spaceName === "Court A")?.slotMinutes).toBe(60);
    expect(day.lanes.find((l) => l.spaceName === "Court B")?.slotMinutes).toBe(30);
  });

  it("has an hour axis from opening hours, so an empty day is still a grid", async () => {
    const { calendarDay } = await import("@/lib/mobile/calendar-json");
    await clear();

    const day = await calendarDay(ORG, TZ, date);
    expect(day.rows[0]).toBe("08:00");
    expect(day.rows.at(-1)).toBe("21:00");
    expect(day.rows).toHaveLength(14);
    // And nothing on it — an empty day is a blank grid, not a blank screen.
    expect(day.lanes.every((l) => l.items.length === 0)).toBe(true);
  });

  it("leaves a paused space out", async () => {
    const { calendarDay } = await import("@/lib/mobile/calendar-json");
    await sql`UPDATE space SET is_active = false WHERE id = ${courtB}::uuid`;
    expect((await calendarDay(ORG, TZ, date)).lanes.map((l) => l.spaceName)).toEqual(["Court A"]);
    await sql`UPDATE space SET is_active = true WHERE id = ${courtB}::uuid`;
  });
});

describe("what lands in which lane (#16)", () => {
  async function book(space: string, from: string, to: string, reference: string) {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO reservation (organization_id, space_id, customer_id, reference, kind,
                               status, party_size, amount_cents, starts_at, ends_at)
      VALUES (${ORG}, ${space}::uuid, ${customerId}::uuid, ${reference}, 'rental', 'confirmed',
              2, 90000, ${await instant(date, from)}, ${await instant(date, to)})
      RETURNING id
    `;
    return row.id;
  }

  it("puts a booking in its own lane and nowhere else", async () => {
    const { calendarDay } = await import("@/lib/mobile/calendar-json");
    await clear();
    await book(courtA, "18:00", "19:00", `C-A-${Date.now()}`);

    const day = await calendarDay(ORG, TZ, date);
    expect(day.lanes.find((l) => l.spaceId === courtA)?.items).toHaveLength(1);
    expect(day.lanes.find((l) => l.spaceId === courtB)?.items).toHaveLength(0);
  });

  it("labels it as venue-local wall clock", async () => {
    const { calendarDay } = await import("@/lib/mobile/calendar-json");
    await clear();
    await book(courtA, "18:00", "19:00", `C-L-${Date.now()}`);

    const [item] = (await calendarDay(ORG, TZ, date)).lanes[0].items;
    expect(item.label).toBe("18:00–19:00");
    expect(item.kind).toBe("booking");
    expect(item.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("draws a venue-wide closure in EVERY lane", async () => {
    // It shuts every space, so drawing it in one lane — or in none, which is
    // what filtering on space_id alone does — hides a closed venue.
    const { calendarDay } = await import("@/lib/mobile/calendar-json");
    await clear();
    await sql`
      INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
      VALUES (${ORG}, NULL, ${await instant(date, "12:00")}, ${await instant(date, "14:00")}, 'Typhoon')
    `;

    const day = await calendarDay(ORG, TZ, date);
    for (const lane of day.lanes) {
      expect(lane.items.filter((i) => i.kind === "block"), lane.spaceName).toHaveLength(1);
    }
  });

  it("draws a single-space closure in that lane only", async () => {
    const { calendarDay } = await import("@/lib/mobile/calendar-json");
    await clear();
    await sql`
      INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
      VALUES (${ORG}, ${courtA}::uuid, ${await instant(date, "12:00")}, ${await instant(date, "13:00")}, 'Net repair')
    `;

    const day = await calendarDay(ORG, TZ, date);
    expect(day.lanes.find((l) => l.spaceId === courtA)?.items).toHaveLength(1);
    expect(day.lanes.find((l) => l.spaceId === courtB)?.items).toHaveLength(0);
  });

  it("keeps yesterday's bookings off today", async () => {
    const { calendarDay } = await import("@/lib/mobile/calendar-json");
    await clear();
    await book(courtA, "18:00", "19:00", `C-D-${Date.now()}`);

    const other = await localDate(3);
    expect((await calendarDay(ORG, TZ, other)).lanes.every((l) => l.items.length === 0)).toBe(true);
  });
});

describe("one block, for what the block endpoint hands back (#19)", () => {
  it("names the space it closes", async () => {
    const { blockItem } = await import("@/lib/mobile/calendar-json");
    await clear();
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
      VALUES (${ORG}, ${courtA}::uuid, ${await instant(date, "12:00")}, ${await instant(date, "14:00")}, 'Net repair')
      RETURNING id
    `;

    const block = await blockItem(ORG, row.id, TZ);
    expect(block).toMatchObject({
      kind: "block",
      title: "Net repair",
      subtitle: "Court A",
      label: "12:00–14:00",
    });
  });

  it("says whole venue when it closes everything, and has a title without a reason", async () => {
    const { blockItem } = await import("@/lib/mobile/calendar-json");
    await clear();
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
      VALUES (${ORG}, NULL, ${await instant(date, "06:00")}, ${await instant(date, "07:00")}, NULL)
      RETURNING id
    `;

    const block = await blockItem(ORG, row.id, TZ);
    expect(block?.subtitle).toBe("Whole venue");
    // A reasonless block still needs something on it, or the row reads as empty.
    expect(block?.title).toBe("Blocked");
  });

  it("is null for another venue's block", async () => {
    const { blockItem } = await import("@/lib/mobile/calendar-json");
    await clear();
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO closure (organization_id, space_id, starts_at, ends_at)
      VALUES (${ORG}, ${courtA}::uuid, ${await instant(date, "12:00")}, ${await instant(date, "13:00")})
      RETURNING id
    `;
    expect(await blockItem("org_not_ours", row.id, TZ)).toBeNull();
  });
});

describe("wall clock, parsed and resolved", () => {
  it("refuses anything that is not YYYY-MM-DD and HH:MM", async () => {
    const { wallClock } = await import("@/lib/mobile/calendar-json");
    expect(wallClock("2026-09-26", "18:00")).toEqual({ y: 2026, mo: 9, day: 26, h: 18, mi: 0 });
    for (const [d, t] of [
      ["2026-9-26", "18:00"],
      ["26/09/2026", "18:00"],
      ["2026-09-26", "6:00"],
      ["2026-09-26", "24:00"],
      ["2026-09-26", "18:60"],
      ["2026-09-26", "18:00:00"],
    ]) {
      expect(wallClock(d, t), `${d} ${t}`).toBeNull();
    }
  });

  it("resolves an instant in the venue's zone, not the process's", async () => {
    // The whole reason this goes through Postgres: `new Date("...T18:00")` in
    // Node means a different moment on a laptop in Manila and a container in
    // Virginia. 18:00 in Manila is 10:00 UTC, always.
    const { instantAt, wallClock } = await import("@/lib/mobile/calendar-json");
    const at = await instantAt(wallClock("2026-09-26", "18:00")!, "Asia/Manila");
    expect(at.toISOString()).toBe("2026-09-26T10:00:00.000Z");

    const madrid = await instantAt(wallClock("2026-09-26", "18:00")!, "Europe/Madrid");
    expect(madrid.toISOString()).toBe("2026-09-26T16:00:00.000Z");
  });
});
