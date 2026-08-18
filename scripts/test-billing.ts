/**
 * Verifies subscription billing against throwaway orgs. Tests the read layer
 * (src/lib/billing.ts) and the exact SQL the admin actions run (the actions
 * themselves are thin auth+audit wrappers over these statements).
 *
 *   npm run test:billing        (local: DATABASE_URL → docker, not Neon)
 *
 * Proves: band tracks active spaces; due-now flips after the trial; a submitted
 * payment shows as pending; approve activates + extends paid_until without losing
 * days; reject records a note; multi-site is a quote; tenant isolation holds.
 */
import postgres from "postgres";

const ORG = "org_billing_test";
const OTHER = "org_billing_other";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const {
    getBillingState,
    listBilling,
    listSubmittedPayments,
    listOrgPayments,
    instapayConfig,
    setPlatformSettings,
  } = await import("../src/lib/billing");

  const mkOrg = async (id: string, activeSpaces: number) => {
    await sql`DELETE FROM organization WHERE id = ${id}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${id}, ${id}, ${id})`;
    await sql`INSERT INTO venue (organization_id) VALUES (${id})`;
    await sql`INSERT INTO subscription (organization_id, status, trial_ends_at)
              VALUES (${id}, 'trialing', now() + interval '1 month')`;
    for (let i = 0; i < activeSpaces; i += 1) {
      await sql`INSERT INTO space (organization_id, name, slug, price_cents, sort_order, is_active)
                VALUES (${id}, ${"S" + i}, ${"s" + i}, 90000, ${i}, true)`;
    }
  };

  try {
    await mkOrg(ORG, 1);
    await mkOrg(OTHER, 1);

    /* ── band tracks active spaces ── */
    let s = await getBillingState(ORG);
    check("new venue is trialing", s.status === "trialing" && !s.dueNow);
    check("1 space → Solo / ₱499", s.band.name === "Solo" && s.amountDueCents === 49900,
      `${s.band.name}/${s.amountDueCents}`);
    check("trial has ~30 days left", (s.daysLeftInTrial ?? 0) >= 27 && (s.daysLeftInTrial ?? 0) <= 31,
      `${s.daysLeftInTrial}`);

    // Activate two more spaces → Club band.
    for (let i = 1; i < 3; i += 1) {
      await sql`INSERT INTO space (organization_id, name, slug, price_cents, sort_order, is_active)
                VALUES (${ORG}, ${"C" + i}, ${"c" + i}, 90000, ${10 + i}, true)`;
    }
    s = await getBillingState(ORG);
    check("3 spaces → Club / ₱999", s.band.name === "Club" && s.amountDueCents === 99900,
      `${s.band.name}/${s.amountDueCents}`);

    /* ── due now after the trial passes ── */
    await sql`UPDATE subscription SET trial_ends_at = now() - interval '1 day' WHERE organization_id = ${ORG}`;
    s = await getBillingState(ORG);
    check("trial lapsed → due now", s.dueNow === true);

    /* ── submit a payment → pending ── */
    await sql`INSERT INTO billing_payment (organization_id, amount_cents, reference, paid_at)
              VALUES (${ORG}, ${s.amountDueCents}, '4021 8837 2210', now()::date)`;
    s = await getBillingState(ORG);
    check("submitted payment shows as pending", s.pendingPayment?.reference === "4021 8837 2210");
    const queue = await listSubmittedPayments();
    check("payment appears in the admin queue", queue.some((p) => p.organizationId === ORG));

    /* ── approve (the admin action's SQL) ── */
    const [pay] = await sql<{ id: string }[]>`
      SELECT id FROM billing_payment WHERE organization_id = ${ORG} AND status = 'submitted' LIMIT 1`;
    await sql.begin(async (tx) => {
      await tx`UPDATE billing_payment SET status='approved', reviewed_at=now() WHERE id = ${pay.id}::uuid AND status='submitted'`;
      await tx`UPDATE subscription
                 SET status='active',
                     paid_until = GREATEST(now(), COALESCE(paid_until, trial_ends_at)) + interval '1 month',
                     updated_at = now()
               WHERE organization_id = ${ORG}`;
    });
    s = await getBillingState(ORG);
    check("approve → active, not due", s.status === "active" && !s.dueNow);
    check("paid_until is ~1 month out", !!s.paidUntil && s.paidUntil.getTime() > Date.now() + 20 * 86400_000,
      s.paidUntil?.toISOString().slice(0, 10));
    check("no pending payment after approval", s.pendingPayment === null);

    /* ── reject path ── */
    await sql`INSERT INTO billing_payment (organization_id, amount_cents, reference, paid_at)
              VALUES (${ORG}, 99900, 'BADREF', now()::date)`;
    const [bad] = await sql<{ id: string }[]>`
      SELECT id FROM billing_payment WHERE organization_id = ${ORG} AND reference = 'BADREF' LIMIT 1`;
    await sql`UPDATE billing_payment SET status='rejected', reviewed_at=now(), note='could not find the transfer'
              WHERE id = ${bad.id}::uuid`;
    const history = await listOrgPayments(ORG);
    check("rejected payment recorded with a note",
      history.some((p) => p.reference === "BADREF" && p.status === "rejected" && !!p.note));

    /* ── multi-site is a quote ── */
    for (let i = 3; i < 16; i += 1) {
      await sql`INSERT INTO space (organization_id, name, slug, price_cents, sort_order, is_active)
                VALUES (${ORG}, ${"M" + i}, ${"m" + i}, 90000, ${100 + i}, true)`;
    }
    s = await getBillingState(ORG);
    check("16 spaces → Multi-site, amount is a quote (null)",
      s.band.name === "Multi-site" && s.amountDueCents === null, `${s.band.name}/${s.amountDueCents}`);

    /* ── listBilling + isolation ── */
    const rows = await listBilling();
    check("listBilling includes our org", rows.some((r) => r.organizationId === ORG));
    const other = await getBillingState(OTHER);
    check("another org's state is independent (still trialing Solo)",
      other.status === "trialing" && other.band.name === "Solo" && !other.dueNow);
    check("another org has no payments", (await listOrgPayments(OTHER)).length === 0);

    /* ── InstaPay config ── */
    await sql`DELETE FROM platform_setting`;
    let cfg = await instapayConfig();
    check("InstaPay starts unconfigured", cfg.configured === false);
    await setPlatformSettings(
      { instapay_qr_url: "https://x/qr.png", instapay_payee: "ReservMe Inc.", instapay_account: "BPI 1234" },
      null as unknown as string,
    );
    cfg = await instapayConfig();
    check("InstaPay config saved + reads back",
      cfg.configured && cfg.qrUrl === "https://x/qr.png" && cfg.payee === "ReservMe Inc.");

    console.log(
      failures === 0
        ? "\nBilling verified: band tracks spaces, due-now, submit/approve/reject, multi-site quote, isolation.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM platform_setting`;
    await sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER})`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
