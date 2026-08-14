/**
 * Grants (or revokes) platform admin.
 *
 *   npm run admin:grant  -- someone@reservme.pro
 *   npm run admin:grant  -- someone@reservme.pro --revoke
 *   npm run admin:grant  -- --list
 *
 * This is deliberately the ONLY way to create the first platform admin.
 * Exposing it in the app would make every account one request away from
 * cross-tenant access; requiring shell plus database credentials means the
 * bootstrap is as protected as the infrastructure itself.
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const list = args.includes("--list");
  const email = args.find((arg) => !arg.startsWith("--"))?.trim().toLowerCase();

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    if (list || !email) {
      const admins = await sql<
        { name: string; email: string; granted_at: Date; revoked_at: Date | null }[]
      >`
        SELECT u.name, u.email, pa.granted_at, pa.revoked_at
        FROM platform_admin pa JOIN "user" u ON u.id = pa.user_id
        ORDER BY pa.granted_at
      `;

      if (admins.length === 0) {
        console.log("No platform admins yet.");
        console.log("Grant one: npm run admin:grant -- you@example.com");
      } else {
        console.log("Platform admins:");
        for (const admin of admins) {
          const state = admin.revoked_at ? "revoked" : "active";
          console.log(`  ${state === "active" ? "●" : "○"} ${admin.email} (${admin.name}) — ${state}`);
        }
      }

      if (!email) return;
    }

    const [user] = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM "user" WHERE lower(email) = ${email}
    `;

    if (!user) {
      console.error(
        `\nNo user with email ${email}.\n` +
          `They need to sign up at the app host first, then run this again.`,
      );
      process.exit(1);
    }

    if (revoke) {
      const [{ remaining }] = await sql<{ remaining: number }[]>`
        SELECT count(*)::int AS remaining FROM platform_admin
        WHERE revoked_at IS NULL AND user_id <> ${user.id}
      `;
      if (remaining === 0) {
        console.error("\nRefusing to revoke the last active platform admin.");
        process.exit(1);
      }

      await sql`
        UPDATE platform_admin SET revoked_at = now()
        WHERE user_id = ${user.id} AND revoked_at IS NULL
      `;
      console.log(`\nRevoked platform admin from ${email}.`);
      return;
    }

    await sql`
      INSERT INTO platform_admin (user_id, note)
      VALUES (${user.id}, 'granted via scripts/grant-admin.ts')
      ON CONFLICT (user_id) DO UPDATE SET revoked_at = NULL
    `;

    console.log(`\nGranted platform admin to ${email} (${user.name}).`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
