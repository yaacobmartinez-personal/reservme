/**
 * P0-1 acceptance: a brand-new venue goes from empty to a live, bookable page
 * through the owner surface — no seed data.
 *
 *   npm run test:onboarding   (needs the dev server running)
 *
 * Server Actions can't be invoked outside a request context, so the actual
 * "add space" click is exercised in the browser pass. This script proves the
 * surrounding data path over real HTTP: signup → authenticated owner pages
 * render → a space created the way createSpace creates it makes the public
 * page bookable → the dashboard flips from empty-state to run sheet.
 */
import { request as httpRequest } from "node:http";
import postgres from "postgres";

const PORT = 3000;
const APP_HOST = "app.localhost:3000";
const APEX_HOST = "localhost:3000";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

type Reply = { status: number; body: string; setCookie: string[] };

function send(
  host: string,
  path: string,
  opts: { method?: string; cookie?: string; json?: unknown } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = opts.json ? JSON.stringify(opts.json) : null;
    const headers: Record<string, string> = { host, origin: `http://${host}` };
    if (body) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(body));
    }
    if (opts.cookie) headers.cookie = opts.cookie;

    const req = httpRequest(
      { host: "127.0.0.1", port: PORT, path, method: opts.method ?? "GET", headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data, setCookie: res.headers["set-cookie"] ?? [] }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });
  const stamp = Date.now();
  const email = `owner-${stamp}@example.com`;
  const slug = `test-venue-${stamp}`;
  const orgId = `org_${stamp}`;

  const { listOwnerSpaces, getOpeningHours, getVenueSettings } = await import("../src/lib/owner");

  try {
    /* 1 · Sign up through the real auth endpoint, on the app host */
    const signup = await send(APP_HOST, "/api/auth/sign-up/email", {
      method: "POST",
      json: { email, password: "correct-horse-battery", name: "Test Owner" },
    });
    check("owner can sign up", signup.status < 400, `status ${signup.status}`);
    const cookie = signup.setCookie.map((c) => c.split(";")[0]).join("; ");

    const [user] = await sql<{ id: string }[]>`SELECT id FROM "user" WHERE email = ${email}`;

    /* 2 · Org + membership + venue (what the signup flow assembles) */
    await sql`INSERT INTO organization (id, name, slug) VALUES (${orgId}, 'Test Venue', ${slug})`;
    await sql`INSERT INTO member (id, organization_id, user_id, role) VALUES (${`m_${stamp}`}, ${orgId}, ${user.id}, 'owner')`;
    await sql`INSERT INTO venue (organization_id, timezone) VALUES (${orgId}, 'Asia/Manila')`;

    check("new venue starts with zero spaces", (await listOwnerSpaces(orgId)).length === 0);
    check("venue settings load with PH defaults", (await getVenueSettings(orgId))?.currency === "PHP");

    /* 3 · The authenticated owner pages render for a real session */
    const emptyDash = await send(APP_HOST, "/", { cookie });
    check(
      "empty venue shows the 'add your first space' first-run",
      emptyDash.status === 200 && emptyDash.body.includes("Add your first space"),
      `status ${emptyDash.status}`,
    );

    const spacesPage = await send(APP_HOST, "/spaces", { cookie });
    check(
      "the Spaces manager renders",
      spacesPage.status === 200 && spacesPage.body.includes("Add a space"),
      `status ${spacesPage.status}`,
    );

    const settingsPage = await send(APP_HOST, "/settings", { cookie });
    check(
      "the Settings manager renders",
      settingsPage.status === 200 && settingsPage.body.includes("Booking policy"),
      `status ${settingsPage.status}`,
    );

    /* 4 · A space created as createSpace creates it (name + seeded week) */
    const [{ next }] = await sql<{ next: number }[]>`
      SELECT COALESCE(max(sort_order)+1,0) AS next FROM space WHERE organization_id=${orgId}`;
    const [space] = await sql<{ id: string }[]>`
      INSERT INTO space (organization_id, name, slug, kind, capacity, slot_minutes, price_cents, sort_order)
      VALUES (${orgId}, 'Court 1', 'court-1', 'court', 1, 60, 90000, ${next}) RETURNING id`;
    for (let w = 0; w < 7; w += 1) {
      await sql`INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at) VALUES (${space.id}::uuid, ${w}, '08:00', '22:00')`;
    }

    check("space is active with a full week of hours", (await getOpeningHours(space.id)).length === 7);

    /* 5 · The public page is now live and bookable.
       The date defaults to today, which may be fully in the past if it's late
       in the venue's evening, so check a few days ahead. Quotes in the RSC
       payload are backslash-escaped, so match on the reason regardless. */
    const [{ future }] = await sql<{ future: string }[]>`
      SELECT ((now() AT TIME ZONE 'Asia/Manila')::date + 3)::text AS future`;
    const publicPage = await send(APEX_HOST, `/${slug}?date=${future}`);
    const hasOpenSlot = /reason\\?":\\?"open\\?"/.test(publicPage.body);
    check(
      "public booking page is live with open slots",
      publicPage.status === 200 && hasOpenSlot,
      `status ${publicPage.status}`,
    );

    /* 6 · The dashboard flips from first-run to the run sheet.
       Matched case-insensitively and without the apostrophe: the panel is
       titled "Today's run sheet", and an apostrophe comes back escaped in the
       RSC payload. This asserted "Run sheet" with a capital R, which the
       dashboard has not rendered since it was redesigned — the check could
       never pass, and the audit step above hid that for as long as it was red. */
    const liveDash = await send(APP_HOST, "/", { cookie });
    check(
      "dashboard now shows the run sheet, not the first-run",
      /run sheet/i.test(liveDash.body) && !liveDash.body.includes("Add your first space"),
    );

    console.log(
      failures === 0
        ? "\nP0-1 verified: an empty venue becomes bookable through the owner surface.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id = ${orgId}`;
    await sql`DELETE FROM "user" WHERE email = ${email}`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
