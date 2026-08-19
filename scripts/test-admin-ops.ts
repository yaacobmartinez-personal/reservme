/**
 * Verifies the new admin ops queries: billingRadar buckets a venue by its
 * billing state (trial ending / overdue-in-grace / suspended), and growthMetrics
 * reports new venues and cancellations per month with a running total. Assertions
 * are relative / by-id so existing local data doesn't matter.
 *
 *   npm run test:admin-ops   (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";

const IDS = [
  "org_ao_ending", "org_ao_far", "org_ao_grace", "org_ao_susp", "org_ao_comp",
  "org_ao_g1", "org_ao_g2", "org_ao_old", "org_ao_cancel",
];
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { billingRadar, growthMetrics } = await import("../src/lib/admin/queries");
  const { BILLING_SUSPEND_REASON } = await import("../src/lib/billing");

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const seed = async (
    id: string,
    opts: {
      status?: string;
      trialOffsetDays?: number;
      createdOffsetMonths?: number;
      cancelled?: boolean;
      suspend?: boolean;
    },
  ) => {
    const { status = "trialing", trialOffsetDays = 30, createdOffsetMonths = 0, cancelled, suspend } = opts;
    await sql`DELETE FROM organization WHERE id = ${id}`;
    await sql`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES (${id}, ${id}, ${id}, now() - make_interval(months => ${createdOffsetMonths}))
    `;
    await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${id}, 'Asia/Manila', 'PHP')`;
    await sql`
      INSERT INTO subscription (organization_id, status, trial_ends_at, updated_at)
      VALUES (${id}, ${cancelled ? "cancelled" : status}, now() + make_interval(days => ${trialOffsetDays}), now())
    `;
    if (suspend) {
      await sql`UPDATE venue SET suspended_at = now(), suspended_reason = ${BILLING_SUSPEND_REASON} WHERE organization_id = ${id}`;
    }
  };

  try {
    /* ── billingRadar ── */
    await seed("org_ao_ending", { trialOffsetDays: 3 }); // trial ends in 3d
    await seed("org_ao_far", { trialOffsetDays: 20 }); // trial ends in 20d
    await seed("org_ao_grace", { trialOffsetDays: -5 }); // overdue, not suspended
    await seed("org_ao_susp", { trialOffsetDays: -30, suspend: true }); // suspended
    await seed("org_ao_comp", { status: "comped", trialOffsetDays: -30 }); // comped

    const radar = await billingRadar();
    const inBucket = (b: { organizationId: string }[], id: string) => b.some((t) => t.organizationId === id);

    check("trial ending soon → endingSoon", inBucket(radar.endingSoon, "org_ao_ending"));
    check("trial far off → not endingSoon", !inBucket(radar.endingSoon, "org_ao_far"));
    check("overdue, unsuspended → inGrace", inBucket(radar.inGrace, "org_ao_grace"));
    check("suspended → suspended bucket", inBucket(radar.suspended, "org_ao_susp"));
    check("suspended → not inGrace", !inBucket(radar.inGrace, "org_ao_susp"));
    check("comped → in no radar bucket", !inBucket(radar.endingSoon, "org_ao_comp") && !inBucket(radar.inGrace, "org_ao_comp") && !inBucket(radar.suspended, "org_ao_comp"));

    /* ── growthMetrics ── */
    const now = new Date();
    const thisMonth = monthKey(now);
    const twoAgo = monthKey(new Date(now.getFullYear(), now.getMonth() - 2, 1));

    const before = await growthMetrics(12);
    const beforeThis = before.find((p) => p.month === thisMonth)?.signups ?? 0;
    const beforeTwoAgo = before.find((p) => p.month === twoAgo)?.signups ?? 0;
    const beforeCancel = before.find((p) => p.month === thisMonth)?.cancellations ?? 0;

    await seed("org_ao_g1", {}); // created this month
    await seed("org_ao_g2", {}); // created this month
    await seed("org_ao_old", { createdOffsetMonths: 2 }); // created 2 months ago
    await seed("org_ao_cancel", { cancelled: true }); // cancelled this month

    const after = await growthMetrics(12);
    check("growthMetrics returns 12 months", after.length === 12, `${after.length}`);
    check(
      "this month's new venues went up by 3",
      (after.find((p) => p.month === thisMonth)?.signups ?? 0) === beforeThis + 3,
      `${after.find((p) => p.month === thisMonth)?.signups} vs ${beforeThis}`,
    );
    check(
      "two months ago went up by 1",
      (after.find((p) => p.month === twoAgo)?.signups ?? 0) === beforeTwoAgo + 1,
    );
    check(
      "this month's cancellations went up by 1",
      (after.find((p) => p.month === thisMonth)?.cancellations ?? 0) === beforeCancel + 1,
    );
    check(
      "cumulative total is non-decreasing",
      after.every((p, i) => i === 0 || p.cumulative >= after[i - 1].cumulative),
    );

    console.log(
      failures === 0
        ? "\nAdmin ops verified: billing radar buckets + growth metrics.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id IN ${sql(IDS)}`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
