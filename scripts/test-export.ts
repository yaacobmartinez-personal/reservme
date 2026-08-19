/**
 * Verifies CSV export: RFC 4180 escaping (pure) and that the customer/booking
 * exports produce a header + rows for a seeded org.
 *
 *   npm run test:export       (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";

const ORG = "org_export_test";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { toCsv, customersCsv, bookingsCsv } = await import("../src/lib/export");

  try {
    /* ── escaping (pure) ── */
    const csv = toCsv(["a", "b"], [["plain", "has,comma"], ['has"quote', "has\nnewline"]]);
    check("comma value is quoted", csv.includes('"has,comma"'));
    check("quote is doubled + wrapped", csv.includes('"has""quote"'));
    check("newline value is quoted", csv.includes('"has\nnewline"'));
    check("header is first line", csv.startsWith("a,b\r\n"));
    check("null renders empty", toCsv(["x"], [[null]]).includes("x\r\n\r\n"));

    /* ── data ── */
    await sql`DELETE FROM organization WHERE id = ${ORG}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Export Test', ${ORG})`;
    await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${ORG}, ${TZ}, 'PHP')`;
    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, sort_order)
      VALUES (${ORG}, 'Court 1', 'court-1', 90000, 0) RETURNING id`;
    const [cust] = await sql<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email, phone, tags)
      VALUES (${ORG}, 'Ana Santos', 'ana@x.com', '+63 900', ARRAY['VIP']) RETURNING id`;
    await sql`
      INSERT INTO reservation (organization_id, space_id, customer_id, kind, status, starts_at, ends_at, amount_cents, reference)
      VALUES (${ORG}, ${space.id}::uuid, ${cust.id}::uuid, 'rental', 'confirmed',
              now() + interval '1 day', now() + interval '1 day' + interval '1 hour', 110000, 'REF-1234')`;

    const custCsv = await customersCsv(ORG, TZ);
    check("customer export has the header", custCsv.startsWith("Name,Email,Phone,Bookings,Lifetime value,No-shows,Tags,Joined"));
    check("customer export includes the customer + LTV", custCsv.includes("Ana Santos") && custCsv.includes("1100.00"));

    const bookCsv = await bookingsCsv(ORG, TZ);
    check("booking export includes the reference + amount", bookCsv.includes("REF-1234") && bookCsv.includes("1100.00"));

    console.log(
      failures === 0
        ? "\nExport verified: CSV escaping + customer/booking exports.\n"
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
