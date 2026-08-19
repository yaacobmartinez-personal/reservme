/**
 * Verifies owner-created sessions: create, weekly recurrence, the guard that
 * refuses a session over a confirmed rental, and that cancel hides it.
 *
 *   npm run test:sessions     (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";

const ORG = "org_sessions_test";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { reserveSpace } = await import("../src/lib/booking/reserve");
  const { listSpaceSessions } = await import("../src/lib/owner");

  const at = async (dayOffset: number, hour: number): Promise<Date> => {
    const [r] = await sql<{ t: Date }[]>`
      SELECT (((now() AT TIME ZONE ${TZ})::date + ${dayOffset}::int) + make_time(${hour}::int,0,0)) AT TIME ZONE ${TZ} AS t`;
    return r.t;
  };

  // The exact guarded INSERT the createSession action runs (Date params here).
  const insertSession = async (spaceId: string, title: string, start: Date, end: Date): Promise<number> => {
    const rows = await sql`
      INSERT INTO play_session (organization_id, space_id, title, starts_at, ends_at, capacity, price_per_person_cents)
      SELECT ${ORG}, sp.id, ${title}, ${start}, ${end}, 12, 35000
      FROM space sp
      WHERE sp.id = ${spaceId}::uuid AND sp.organization_id = ${ORG}
        AND NOT EXISTS (
          SELECT 1 FROM reservation r
          WHERE r.space_id = sp.id AND r.status IN ('held','confirmed') AND r.kind = 'rental'
            AND r.during && tstzrange(${start}, ${end}, '[)')
        )
      RETURNING id`;
    return rows.length;
  };

  try {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Sessions Test', ${ORG})`;
    await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${ORG}, ${TZ}, 'PHP')`;
    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
      VALUES (${ORG}, 'Court 1', 'court-1', 90000, 60, 0) RETURNING id`;
    for (let w = 0; w < 7; w += 1) {
      await sql`INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
                VALUES (${space.id}::uuid, ${w}, '00:00', '23:59')`;
    }

    /* ── create on a free slot ── */
    const first = await insertSession(space.id, "Open play", await at(2, 19), await at(2, 21));
    check("a session is created on a free slot", first === 1, `${first}`);

    /* ── weekly recurrence (4 free weeks) ── */
    let made = 0;
    for (let i = 0; i < 4; i += 1) {
      made += await insertSession(space.id, "Weekly class", await at(5 + i * 7, 19), await at(5 + i * 7, 21));
    }
    check("weekly recurrence creates 4 sessions", made === 4, `${made}`);

    /* ── refuse over a confirmed rental ── */
    await reserveSpace({
      organizationId: ORG, spaceId: space.id, startsAt: await at(4, 19), endsAt: await at(4, 20),
      customer: { name: "R", email: "r@x.com" },
    });
    const blocked = await insertSession(space.id, "Clashing", await at(4, 19), await at(4, 21));
    check("a session over a confirmed rental is refused", blocked === 0, `${blocked}`);

    /* ── listSpaceSessions shows upcoming, hides cancelled ── */
    const before = await listSpaceSessions(space.id, TZ);
    check("upcoming sessions are listed", before.length === 5, `${before.length}`);
    await sql`UPDATE play_session SET cancelled = true WHERE space_id = ${space.id}::uuid AND title = 'Open play'`;
    const after = await listSpaceSessions(space.id, TZ);
    check("a cancelled session drops out of the list", after.length === 4, `${after.length}`);

    console.log(
      failures === 0
        ? "\nSessions verified: create, weekly recurrence, rental-conflict guard, cancel.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
