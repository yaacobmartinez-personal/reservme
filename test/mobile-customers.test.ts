import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Customers and the waitlist (docs/API-CONTRACT.md #20–#23).
 *
 * The reads are `listCustomers` / `getCustomer` / `listWaitlist`, which the web
 * already tests; what is checked here is the part that is new — the shape the
 * app reads, the segments the chips send, and the four CRM writes, each of
 * which has to refuse a customer belonging to somebody else.
 */

const ORG = "org_cust_test";
const OTHER = "org_cust_other";
const TZ = "Asia/Manila";

let sql: postgres.Sql;
let courtId: string;
let regular: string; // 4 confirmed bookings, one of them today
let quiet: string; // one booking, long ago, and a no-show
let fresh: string; // no bookings at all
let foreign: string; // belongs to OTHER

async function instant(offsetDays: number, time: string) {
  const [row] = await sql<{ at: Date }[]>`
    SELECT (((now() AT TIME ZONE ${TZ})::date + ${offsetDays}::int) + ${time}::time)
           AT TIME ZONE ${TZ} AS at
  `;
  return row.at;
}

let seq = 0;
async function book(
  customerId: string,
  offsetDays: number,
  time: string,
  status = "confirmed",
  cents = 90000,
) {
  seq += 1;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO reservation (organization_id, space_id, customer_id, reference, kind,
                             status, party_size, amount_cents, starts_at, ends_at)
    VALUES (${ORG}, ${courtId}::uuid, ${customerId}::uuid,
            ${`CU-${Date.now()}-${seq}`}, 'rental', ${status}, 2, ${cents},
            ${await instant(offsetDays, time)}, ${await instant(offsetDays, time)} + interval '1 hour')
    RETURNING id
  `;
  return row.id;
}

async function customer(org: string, name: string, email: string, extra: Partial<{
  phone: string;
  tags: string[];
  noShows: number;
  createdDaysAgo: number;
}> = {}) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO customer (organization_id, name, email, phone, tags, no_show_count, created_at)
    VALUES (${org}, ${name}, ${email}, ${extra.phone ?? null},
            ${extra.tags ?? []}, ${extra.noShows ?? 0},
            now() - ${`${extra.createdDaysAgo ?? 400} days`}::interval)
    RETURNING id
  `;
  return row.id;
}

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  for (const id of [ORG, OTHER]) await sql`DELETE FROM organization WHERE id = ${id}`;

  await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Cust Test', 'cust-test')`;
  await sql`INSERT INTO venue (organization_id, timezone) VALUES (${ORG}, ${TZ})`;
  await sql`INSERT INTO organization (id, name, slug) VALUES (${OTHER}, 'Other', 'cust-other')`;
  await sql`INSERT INTO venue (organization_id, timezone) VALUES (${OTHER}, ${TZ})`;

  const [space] = await sql<{ id: string }[]>`
    INSERT INTO space (organization_id, name, slug, slot_minutes, sort_order, is_active)
    VALUES (${ORG}, 'Court 1', 'court-1', 60, 0, true) RETURNING id
  `;
  courtId = space.id;

  regular = await customer(ORG, "Ramon Cruz", "ramon@cust.test", {
    phone: "+63 917 000 0001",
    tags: ["Regular"],
  });
  quiet = await customer(ORG, "Bea Santos", "bea@cust.test", { noShows: 2 });
  fresh = await customer(ORG, "New Face", "new@cust.test", { createdDaysAgo: 3 });
  foreign = await customer(OTHER, "Not Ours", "nope@cust.test");

  // Three past and one ahead — four confirmed bookings makes a regular.
  await book(regular, -120, "18:00");
  await book(regular, -40, "18:00");
  await book(regular, -5, "18:00");
  await book(regular, 3, "19:00");
  // A cancellation is not revenue and does not count as a booking.
  await book(regular, -2, "20:00", "cancelled", 50000);
  // Bea came once, ninety days ago.
  await book(quiet, -90, "09:00");
}, 60_000);

afterAll(async () => {
  for (const id of [ORG, OTHER]) await sql`DELETE FROM organization WHERE id = ${id}`;
  await sql.end();
});

describe("the list, and the chips on it (#20)", () => {
  it("counts confirmed bookings and their value, and nothing else", async () => {
    const { listCustomers } = await import("@/lib/customers");
    const { customerSummary } = await import("@/lib/mobile/customer-json");

    const { rows } = await listCustomers(ORG, TZ, { sort: "name" });
    const ramon = customerSummary(rows.find((r) => r.id === regular)!);

    // Four confirmed at ₱900; the cancelled ₱500 is neither a booking nor revenue.
    expect(ramon.bookings).toBe(4);
    expect(ramon.lifetimeValueCents).toBe(360000);
    expect(ramon.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("gives days since the last visit, not a date", async () => {
    // The screen says "5 days ago". Working that out on the phone would drift
    // against the venue's own today, which is the only today that counts.
    const { listCustomers } = await import("@/lib/customers");
    const { customerSummary } = await import("@/lib/mobile/customer-json");

    const { rows } = await listCustomers(ORG, TZ, { sort: "name" });
    expect(customerSummary(rows.find((r) => r.id === regular)!).lastVisitDays).toBe(5);
    // Never been: null, not zero — zero would read as "came today".
    expect(customerSummary(rows.find((r) => r.id === fresh)!).lastVisitDays).toBeNull();
  });

  it("maps every chip the app sends, and ignores one it does not know", async () => {
    const { segmentOf } = await import("@/lib/mobile/customer-json");
    expect(segmentOf("regulars")).toBe("regulars");
    expect(segmentOf("noShows")).toBe("no_shows");
    expect(segmentOf("newThisMonth")).toBe("new");
    // A newer app asking for a segment this server lacks should see everybody,
    // not an error screen.
    expect(segmentOf("whales")).toBeUndefined();
    expect(segmentOf(null)).toBeUndefined();
  });

  it("filters by each segment", async () => {
    const { listCustomers } = await import("@/lib/customers");
    const ids = async (segment: "regulars" | "no_shows" | "new") =>
      (await listCustomers(ORG, TZ, { segment })).rows.map((r) => r.id);

    expect(await ids("regulars")).toEqual([regular]);
    expect(await ids("no_shows")).toEqual([quiet]);
    expect(await ids("new")).toEqual([fresh]);
  });

  it("never reaches another venue's customers", async () => {
    const { listCustomers } = await import("@/lib/customers");
    const { rows } = await listCustomers(ORG, TZ, { search: "Not Ours" });
    expect(rows).toHaveLength(0);
  });
});

describe("one customer's page (#21)", () => {
  it("splits the history at now, with the next booking first", async () => {
    const { customerDetail } = await import("@/lib/mobile/customer-json");
    const page = (await customerDetail(ORG, regular, TZ))!;

    expect(page.upcoming.map((b) => b.reference)).toHaveLength(1);
    // Three confirmed and one cancelled: a cancellation still belongs on the
    // history, it just is not revenue.
    expect(page.past).toHaveLength(4);
    expect(new Date(page.upcoming[0].startsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("labels each booking in the venue's own wall clock", async () => {
    const { customerDetail } = await import("@/lib/mobile/customer-json");
    const page = (await customerDetail(ORG, regular, TZ))!;
    expect(page.upcoming[0].whenLabel).toMatch(/^\w{3} \d{2} \w{3} · 19:00$/);
  });

  it("carries the reference, because that is what the customer quotes", async () => {
    const { customerDetail } = await import("@/lib/mobile/customer-json");
    const page = (await customerDetail(ORG, regular, TZ))!;
    expect(page.upcoming[0].reference).toMatch(/^CU-/);
    expect(page.upcoming[0].checkedInAt).toBeNull();
  });

  it("is null for a customer of another venue", async () => {
    // The whole tenancy guarantee in one line: a real id, the wrong org.
    const { customerDetail } = await import("@/lib/mobile/customer-json");
    expect(await customerDetail(ORG, foreign, TZ)).toBeNull();
  });
});

describe("the CRM writes, and what they refuse (#22)", () => {
  it("writes a note only for a customer of this venue", async () => {
    const { addNote, removeNote } = await import("@/lib/mobile/customer-json");

    const note = await addNote(ORG, regular, null, "  Prefers court 2  ");
    expect(note?.body).toBe("Prefers court 2");

    // Same id, wrong org: nothing is written, and nothing had to remember to
    // check — the ownership test is inside the INSERT.
    expect(await addNote(ORG, foreign, null, "Should not land")).toBeNull();
    expect(await removeNote(ORG, regular, note!.id)).toBe(true);
    // Deleting it twice is not a success the second time.
    expect(await removeNote(ORG, regular, note!.id)).toBe(false);
  });

  it("refuses an empty or oversized note in the desk's own words", async () => {
    const { noteProblem } = await import("@/lib/mobile/customer-json");
    expect(noteProblem("   ")).toBe("Write something first.");
    expect(noteProblem("x".repeat(2001))).toBe("That note is too long.");
    expect(noteProblem("Called about Saturday")).toBeNull();
  });

  it("replaces the whole tag list, so a retry cannot duplicate one", async () => {
    const { setTags, customerSummaryById } = await import("@/lib/mobile/customer-json");

    expect(await setTags(ORG, regular, ["Regular", "Coach"])).toBe(true);
    expect(await setTags(ORG, regular, ["Regular", "Coach"])).toBe(true);
    const after = await customerSummaryById(ORG, regular, TZ);
    expect(after?.tags).toEqual(["Regular", "Coach"]);

    expect(await setTags(ORG, foreign, ["Sneaky"])).toBe(false);
  });

  it("keeps the tag rules the app already enforces, word for word", async () => {
    const { tagsProblem } = await import("@/lib/mobile/customer-json");
    expect(tagsProblem([])).toBeNull();
    expect(tagsProblem(["  "])).toBe("Tag can't be empty.");
    expect(tagsProblem(["x".repeat(31)])).toBe("Keep tags under 30 characters.");
    expect(tagsProblem(["semi;colon"])).toBe("Tags can use letters, numbers, spaces and - . &");
    expect(tagsProblem(["Regular", "regular"])).toBe("That tag is already on this customer.");
    expect(tagsProblem(Array.from({ length: 21 }, (_, i) => `t${i}`))).toBe(
      "That is as many tags as one customer can have.",
    );
    // Accents and & are ordinary in Philippine venue tags.
    expect(tagsProblem(["Señor Cruz", "Pay & Play"])).toBeNull();
  });

  it("changes the name and phone, and leaves the email alone", async () => {
    const { setContact, customerSummaryById } = await import("@/lib/mobile/customer-json");

    expect(await setContact(ORG, quiet, "  Beatriz Santos  ", " +63 917 555 0000 ")).toBe(true);
    const after = (await customerSummaryById(ORG, quiet, TZ))!;
    expect(after.name).toBe("Beatriz Santos");
    expect(after.phone).toBe("+63 917 555 0000");
    // The identity key the booking engine matches returning customers on.
    expect(after.email).toBe("bea@cust.test");

    // An emptied phone is absent, not an empty string.
    await setContact(ORG, quiet, "Beatriz Santos", "   ");
    expect((await customerSummaryById(ORG, quiet, TZ))!.phone).toBeNull();
    expect(await setContact(ORG, foreign, "Renamed", null)).toBe(false);
  });

  it("refuses a nameless customer", async () => {
    const { contactProblem } = await import("@/lib/mobile/customer-json");
    expect(contactProblem("  ", null)).toBe("Name can't be empty.");
    expect(contactProblem("x".repeat(121), null)).toBe("That name is too long.");
    expect(contactProblem("Ramon", "9".repeat(41))).toBe("That phone number is too long.");
    expect(contactProblem("Ramon", null)).toBeNull();
  });
});

describe("the waitlist (#23)", () => {
  async function wait(customerId: string, offsetDays: number, time: string, status = "waiting") {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO waitlist (organization_id, space_id, starts_at, ends_at, customer_id, status)
      VALUES (${ORG}, ${courtId}::uuid, ${await instant(offsetDays, time)},
              ${await instant(offsetDays, time)} + interval '1 hour', ${customerId}::uuid, ${status})
      RETURNING id
    `;
    return row.id;
  }

  it("lists who is waiting, soonest slot first", async () => {
    const { waitlistEntries } = await import("@/lib/mobile/waitlist-json");
    await sql`DELETE FROM waitlist WHERE organization_id = ${ORG}`;

    const later = await wait(regular, 5, "18:00");
    const sooner = await wait(quiet, 2, "09:00");

    const entries = await waitlistEntries(ORG, TZ);
    expect(entries.map((e) => e.id)).toEqual([sooner, later]);
    expect(entries[0].customerName).toBe("Beatriz Santos");
    expect(entries[0].whenLabel).toMatch(/^\w{3} \d{2} \w{3} · 09:00$/);
    expect(entries[0].startsAt).toMatch(/Z$/);
  });

  it("drops a slot that has already passed, and a claimed entry", async () => {
    // A queue for a slot in the past is history, not work.
    const { waitlistEntries } = await import("@/lib/mobile/waitlist-json");
    await sql`DELETE FROM waitlist WHERE organization_id = ${ORG}`;

    await wait(regular, -2, "18:00");
    await wait(quiet, 4, "10:00", "converted");
    expect(await waitlistEntries(ORG, TZ)).toHaveLength(0);
  });

  it("has no claim countdown, because the server has no claim window", async () => {
    // Being notified is an email with a booking link — first to book wins. A
    // deadline the server does not enforce would be a promise the venue
    // could not keep.
    const { waitlistEntries } = await import("@/lib/mobile/waitlist-json");
    await sql`DELETE FROM waitlist WHERE organization_id = ${ORG}`;

    const id = await wait(regular, 3, "18:00", "notified");
    await sql`UPDATE waitlist SET notified_at = now() WHERE id = ${id}::uuid`;

    const [entry] = await waitlistEntries(ORG, TZ);
    expect(entry.status).toBe("notified");
    expect(entry.notifiedAt).toMatch(/Z$/);
    expect(entry.claimExpiresAt).toBeNull();
  });
});
