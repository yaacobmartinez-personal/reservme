/**
 * Verifies billing auto-suspension: a venue still unpaid GRACE_DAYS after its
 * free month (or paid period) ends gets its public page turned off; venues
 * within grace, comped, or already manually suspended are left alone; and an
 * approved payment (liftBillingSuspension) reverses a billing suspension but
 * never a manual/abuse one.
 *
 *   npm run test:suspension   (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";
import { expect, it } from "vitest";

const IDS = ["org_susp_a", "org_susp_b", "org_susp_c", "org_susp_d", "org_susp_e", "org_susp_f"];
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { suspendOverdue } = await import("../src/lib/billing-reminders");
  const { liftBillingSuspension, getBillingState, GRACE_DAYS, BILLING_SUSPEND_REASON } =
    await import("../src/lib/billing");

  const seed = async (
    id: string,
    status: string,
    trialDaysAgo: number,
    paidDaysAgo: number | null,
  ) => {
    await sql`DELETE FROM organization WHERE id = ${id}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${id}, ${id}, ${id})`;
    await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${id}, 'Asia/Manila', 'PHP')`;
    const paidVal =
      paidDaysAgo == null ? sql`NULL` : sql`now() - make_interval(days => ${paidDaysAgo})`;
    await sql`
      INSERT INTO subscription (organization_id, status, trial_ends_at, paid_until)
      VALUES (${id}, ${status}, now() - make_interval(days => ${trialDaysAgo}), ${paidVal})
    `;
  };

  const susp = async (id: string) =>
    (await sql<{ suspended_at: Date | null; suspended_reason: string | null }[]>`
      SELECT suspended_at, suspended_reason FROM venue WHERE organization_id = ${id}
    `)[0];

  try {
    const past = GRACE_DAYS + 1;
    await seed("org_susp_a", "trialing", past, null); // overdue past grace → suspend
    await seed("org_susp_b", "trialing", 5, null); // within grace → keep
    await seed("org_susp_c", "comped", 60, null); // comped → never
    await seed("org_susp_d", "active", 40, past); // paid period lapsed past grace → suspend
    await seed("org_susp_e", "active", 40, 2); // paid, within grace → keep
    await seed("org_susp_f", "trialing", 60, null); // overdue, but already manually suspended
    await sql`UPDATE venue SET suspended_at = now(), suspended_reason = 'Reported for abuse' WHERE organization_id = 'org_susp_f'`;

    const n = await suspendOverdue();
    check("suspends exactly the two overdue venues", n === 2, `${n}`);

    check("A (trial lapsed past grace) is suspended", (await susp("org_susp_a")).suspended_at !== null);
    check("A carries the billing reason", (await susp("org_susp_a")).suspended_reason === BILLING_SUSPEND_REASON);
    check("B (within grace) stays live", (await susp("org_susp_b")).suspended_at === null);
    check("C (comped) stays live", (await susp("org_susp_c")).suspended_at === null);
    check("D (paid period lapsed) is suspended", (await susp("org_susp_d")).suspended_at !== null);
    check("E (paid, within grace) stays live", (await susp("org_susp_e")).suspended_at === null);
    check("F's manual suspension reason is untouched", (await susp("org_susp_f")).suspended_reason === "Reported for abuse");

    check("billing state reflects the suspension", (await getBillingState("org_susp_a")).suspended === true);

    // Idempotent — a second pass suspends no one new.
    check("a second pass is a no-op", (await suspendOverdue()) === 0);

    // Paying lifts a billing suspension...
    await liftBillingSuspension("org_susp_a");
    check("an approved payment lifts the billing suspension", (await susp("org_susp_a")).suspended_at === null);
    check("billing state clears too", (await getBillingState("org_susp_a")).suspended === false);

    // ...but never a manual/abuse suspension.
    await liftBillingSuspension("org_susp_f");
    check("paying can't lift a manual suspension", (await susp("org_susp_f")).suspended_at !== null);

    console.log(
      failures === 0
        ? "\nAuto-suspension verified: grace window, exclusions, idempotency, scoped lift.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id IN ${sql(IDS)}`;
    await sql.end();
  }
}

it("billing auto-suspension", async () => {
  await main();
  expect(failures, "one or more checks failed").toBe(0);
}, 30_000);
