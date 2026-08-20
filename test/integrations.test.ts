/**
 * Verifies distribution & integrations:
 *   - iCal: the feed lists only the org's confirmed bookings; token lookup
 *     resolves a venue and rejects junk.
 *   - Webhooks: signPayload is a verifiable HMAC; fan-out selects only active
 *     endpoints subscribed to the event; deliverWebhook signs + POSTs and throws
 *     on a non-2xx.
 *   - API keys: a fresh key verifies to its org; wrong/revoked keys and another
 *     org's key are rejected.
 *   - Transactions CSV includes gross/discount/net.
 *
 *   npm run test:integrations   (local: DATABASE_URL → docker, not Neon)
 */
import crypto from "node:crypto";
import http from "node:http";
import postgres from "postgres";
import { expect, it } from "vitest";

const ORG = "org_integ_test";
const OTHER = "org_integ_other";
const TZ = "Asia/Manila";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const ical = await import("../src/lib/ical");
  const wh = await import("../src/lib/webhooks");
  const keys = await import("../src/lib/api-keys");
  const { transactionsCsv } = await import("../src/lib/export");
  const { reserveSpace } = await import("../src/lib/booking/reserve");

  const seedOrg = async (id: string) => {
    await sql`DELETE FROM organization WHERE id = ${id}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${id}, ${id}, ${id})`;
    await sql`INSERT INTO venue (organization_id, timezone, currency) VALUES (${id}, ${TZ}, 'PHP')`;
    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, price_cents, slot_minutes, sort_order)
      VALUES (${id}, 'Court 1', 'court-1', 90000, 60, 0) RETURNING id`;
    for (let w = 0; w < 7; w += 1) {
      await sql`INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
                VALUES (${space.id}::uuid, ${w}, '00:00', '23:59')`;
    }
    return space.id;
  };

  try {
    const spaceA = await seedOrg(ORG);
    await seedOrg(OTHER);

    const at = async (org: string, hour: number, day = 2): Promise<Date> => {
      const [r] = await sql<{ t: Date }[]>`
        SELECT (((now() AT TIME ZONE ${TZ})::date + ${day}::int) + make_time(${hour}::int,0,0)) AT TIME ZONE ${TZ} AS t`;
      return r.t;
    };
    const booking = await reserveSpace({
      organizationId: ORG, spaceId: spaceA, startsAt: await at(ORG, 10), endsAt: await at(ORG, 11),
      customer: { name: "Ana Cruz", email: "ana@x.com" },
    });

    /* ── iCal ── */
    const [{ tok }] = await sql<{ tok: string }[]>`SELECT ical_token AS tok FROM venue WHERE organization_id=${ORG}`;
    const resolved = await ical.venueByIcalToken(tok);
    check("token resolves the venue", resolved?.organizationId === ORG);
    check("junk token is rejected", (await ical.venueByIcalToken("not-a-uuid")) === null);
    const feed = await ical.buildIcalFeed(ORG, "Test", TZ);
    check("feed is a VCALENDAR", feed.startsWith("BEGIN:VCALENDAR"));
    check("feed lists the org's booking", feed.includes(`${booking.reference}@reservme.pro`));
    const otherFeed = await ical.buildIcalFeed(OTHER, "Other", TZ);
    check("another org's feed doesn't leak it", !otherFeed.includes(booking.reference));

    /* ── webhook signing ── */
    const body = JSON.stringify({ hello: "world" });
    const sig = wh.signPayload("shh", body);
    const expected = "sha256=" + crypto.createHmac("sha256", "shh").update(body).digest("hex");
    check("signPayload is a verifiable HMAC", sig === expected);

    /* ── webhook fan-out ── */
    const made = await wh.createWebhook(ORG, "http://localhost:1/created", ["booking.created"]);
    check("createWebhook returns a secret", made.secret.startsWith("whsec_"));
    await wh.createWebhook(ORG, "http://localhost:1/cancelled", ["booking.cancelled"]);
    const [inactive] = await sql<{ id: string }[]>`
      INSERT INTO webhook_endpoint (organization_id, url, secret, events, active)
      VALUES (${ORG}, 'http://localhost:1/off', 's', ARRAY['booking.created'], false) RETURNING id`;
    void inactive;
    const targets = await wh.selectWebhookTargets(ORG, "booking.created");
    check("fan-out picks only active endpoints for the event", targets.length === 1, `${targets.length}`);
    check("the picked endpoint is the right one", targets[0]?.url.endsWith("/created"));
    const listed = await wh.listWebhooks(ORG);
    check("listWebhooks returns all three", listed.length === 3, `${listed.length}`);

    /* ── webhook delivery ── */
    const box: { r: { sig?: string; event?: string; body: string } | null } = { r: null };
    const server = http.createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        box.r = {
          sig: req.headers["x-reservme-signature"] as string | undefined,
          event: req.headers["x-reservme-event"] as string | undefined,
          body: data,
        };
        res.statusCode = req.url === "/fail" ? 500 : 200;
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const payload = JSON.stringify({ event: "booking.created", ref: booking.reference });
    await wh.deliverWebhook({
      url: `http://localhost:${port}/hook`,
      event: "booking.created",
      body: payload,
      signature: wh.signPayload("shh", payload),
    });
    check("delivery POSTs the signed body", box.r?.body === payload && box.r?.sig === wh.signPayload("shh", payload));
    check("delivery sends the event header", box.r?.event === "booking.created");
    let threw = false;
    try {
      await wh.deliverWebhook({ url: `http://localhost:${port}/fail`, event: "x", body: "{}", signature: "s" });
    } catch {
      threw = true;
    }
    check("a non-2xx delivery throws (so pg-boss retries)", threw);
    server.close();

    /* ── API keys ── */
    const k = await keys.createApiKey(ORG, "Zapier");
    check("createApiKey returns a key", k.key.startsWith("rk_live_"));
    check("a valid key resolves to its org", (await keys.verifyApiKey(k.key))?.organizationId === ORG);
    check("a wrong key is rejected", (await keys.verifyApiKey("rk_live_nope")) === null);
    check("a non-key string is rejected", (await keys.verifyApiKey("hello")) === null);

    const kOther = await keys.createApiKey(OTHER, "Theirs");
    check("keys are org-scoped", (await keys.verifyApiKey(kOther.key))?.organizationId === OTHER);

    await keys.revokeApiKey(ORG, (await keys.listApiKeys(ORG)).find((x) => x.name === "Zapier")!.id);
    check("a revoked key stops working", (await keys.verifyApiKey(k.key)) === null);

    /* ── transactions CSV ── */
    // Give the booking a ₱200 promo discount so gross ≠ net.
    const [promo] = await sql<{ id: string }[]>`
      INSERT INTO promo_code (organization_id, code, kind, value) VALUES (${ORG}, 'X', 'amount', 20000) RETURNING id`;
    await sql`INSERT INTO promo_redemption (organization_id, promo_code_id, reservation_id, discount_cents)
              VALUES (${ORG}, ${promo.id}::uuid, ${booking.id}::uuid, 20000)`;
    await sql`UPDATE reservation SET amount_cents = 70000 WHERE id = ${booking.id}::uuid`;
    const csv = await transactionsCsv(ORG, TZ);
    check("transactions CSV has the finance header", csv.includes("Gross,Discount,Net"));
    check("transactions CSV shows gross/discount/net", csv.includes("900.00,200.00,700.00"));

    console.log(
      failures === 0
        ? "\nIntegrations verified: iCal, webhook sign/fan-out/deliver, API keys, transactions CSV.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER})`;
    await sql.end();
  }
}

it("distribution & integrations", async () => {
  await main();
  expect(failures, "one or more checks failed").toBe(0);
}, 30_000);
