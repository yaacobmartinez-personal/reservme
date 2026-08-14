/** Development seed: one venue, three courts, open hours, one open-play session. */
import postgres from "postgres";

const ORG_ID = "org_katipunan";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM organization WHERE id = ${ORG_ID}`;

      await tx`
        INSERT INTO organization (id, name, slug)
        VALUES (${ORG_ID}, 'Katipunan Padel', 'katipunan')
      `;

      await tx`
        INSERT INTO venue (organization_id, timezone, currency, tagline, address,
                           min_notice_minutes, max_horizon_days, gcash_name)
        VALUES (${ORG_ID}, 'Asia/Manila', 'PHP',
                'Two panoramic courts on Katipunan Ave.',
                'Katipunan Ave, Quezon City',
                60, 60, 'Katipunan Padel Inc.')
      `;

      const courts = [
        { name: "Court 1", slug: "court-1", price: 900_00 },
        { name: "Court 2 · Panoramic", slug: "court-2", price: 1_100_00 },
        { name: "Court 3", slug: "court-3", price: 900_00 },
      ];

      for (const [index, court] of courts.entries()) {
        const [space] = await tx<{ id: string }[]>`
          INSERT INTO space (organization_id, name, slug, kind, capacity,
                             slot_minutes, buffer_minutes, price_cents, sort_order)
          VALUES (${ORG_ID}, ${court.name}, ${court.slug}, 'court', 12,
                  60, 0, ${court.price}, ${index})
          RETURNING id
        `;

        // Open 06:00–22:00, every day, in venue-local time.
        for (let weekday = 0; weekday < 7; weekday += 1) {
          await tx`
            INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
            VALUES (${space.id}::uuid, ${weekday}, '06:00', '22:00')
          `;
        }

        if (index === 0) {
          await tx`
            INSERT INTO play_session (organization_id, space_id, title,
                                      starts_at, ends_at, capacity, booked_spots,
                                      price_per_person_cents)
            VALUES (
              ${ORG_ID}, ${space.id}::uuid, 'Open play',
              (( (now() AT TIME ZONE 'Asia/Manila')::date + 1 + time '19:00') AT TIME ZONE 'Asia/Manila'),
              (( (now() AT TIME ZONE 'Asia/Manila')::date + 1 + time '21:00') AT TIME ZONE 'Asia/Manila'),
              12, 9, 350_00
            )
          `;
        }
      }
    });

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text FROM space WHERE organization_id = ${ORG_ID}
    `;
    console.log(`Seeded Katipunan Padel with ${count} spaces at /katipunan`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
