/**
 * Verifies billing reminders: an owner is nudged once when the free month is
 * ending, and once when it has lapsed — a re-run doesn't re-send.
 *
 *   npm run test:reminders     (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";

const SOON = "org_remind_soon";
const DUE = "org_remind_due";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { sendBillingReminders } = await import("../src/lib/billing-reminders");

  const seed = async (org: string, trialOffsetDays: number) => {
    const uid = `owner_${org}_${Date.now()}`;
    await sql`DELETE FROM organization WHERE id = ${org}`;
    await sql`DELETE FROM "user" WHERE email = ${org + "@x.com"}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${org}, ${org}, ${org})`;
    await sql`INSERT INTO venue (organization_id) VALUES (${org})`;
    await sql`INSERT INTO space (organization_id, name, slug, price_cents, sort_order, is_active)
              VALUES (${org}, 'Court', 'court', 49900, 0, true)`; // 1 space → Solo ₱499
    await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
              VALUES (${uid}, 'Owner', ${org + "@x.com"}, true, now(), now())`;
    await sql`INSERT INTO member (id, organization_id, user_id, role, created_at)
              VALUES (${"mem_" + Math.random().toString(36).slice(2)}, ${org}, ${uid}, 'owner', now())`;
    await sql`INSERT INTO subscription (organization_id, status, trial_ends_at)
              VALUES (${org}, 'trialing', now() + (${trialOffsetDays}::text || ' days')::interval)`;
    return uid;
  };

  try {
    await seed(SOON, 3); // ends in 3 days → "ending soon"
    await seed(DUE, -1); // ended yesterday → "past due"

    const first = await sendBillingReminders();
    check("an ending-soon trial is reminded", first.trialSoon >= 1, `${first.trialSoon}`);
    check("a lapsed trial is reminded", first.pastDue >= 1, `${first.pastDue}`);

    const [soonRow] = await sql<{ set: boolean }[]>`
      SELECT trial_reminder_at IS NOT NULL AS set FROM subscription WHERE organization_id = ${SOON}`;
    check("trial_reminder_at is stamped", soonRow.set === true);
    const [dueRow] = await sql<{ set: boolean }[]>`
      SELECT due_reminder_at IS NOT NULL AS set FROM subscription WHERE organization_id = ${DUE}`;
    check("due_reminder_at is stamped", dueRow.set === true);

    const second = await sendBillingReminders();
    check("a re-run doesn't re-send (deduped)", second.trialSoon === 0 && second.pastDue === 0,
      `${second.trialSoon}/${second.pastDue}`);

    console.log(
      failures === 0
        ? "\nBilling reminders verified: nudge once for ending-soon and past-due, no duplicates.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM "user" WHERE email IN (${SOON + "@x.com"}, ${DUE + "@x.com"})`;
    await sql`DELETE FROM organization WHERE id IN (${SOON}, ${DUE})`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
