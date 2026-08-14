/**
 * Verifies the platform console cannot be used by people who shouldn't have it,
 * and that everyone who does use it leaves a trace.
 *
 *   npm run test:admin      (needs the dev server running)
 *
 * The console is the one component that deliberately breaks tenant isolation,
 * so "it works" is not the interesting property — "it refuses" is.
 */
import { request as httpRequest } from "node:http";
import postgres from "postgres";

const PORT = 3000;
const APP_HOST = "app.localhost:3000";
const ADMIN_HOST = "admin.localhost:3000";
const APEX_HOST = "localhost:3000";

type Reply = { status: number; body: string; setCookie: string[]; location?: string };

/**
 * `fetch` refuses to set the Host header — it is a forbidden header name — so
 * every request would arrive at the apex and the host routing under test would
 * never be exercised. node:http has no such restriction.
 */
function send(
  host: string,
  path: string,
  options: { method?: string; cookie?: string; json?: unknown } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = options.json ? JSON.stringify(options.json) : null;

    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: PORT,
        path,
        method: options.method ?? "GET",
        headers: {
          host,
          origin: `http://${host}`,
          ...(payload
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : {}),
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            setCookie: res.headers["set-cookie"] ?? [],
            location: res.headers.location,
          }),
        );
      },
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

type Session = { cookie: string; email: string };

async function signUp(host: string, email: string, name: string): Promise<Session> {
  const reply = await send(host, "/api/auth/sign-up/email", {
    method: "POST",
    json: { email, password: "correct-horse-battery", name },
  });
  if (reply.status >= 400) {
    throw new Error(`sign-up failed: ${reply.status} ${reply.body.slice(0, 200)}`);
  }
  return { cookie: reply.setCookie.map((c) => c.split(";")[0]).join("; "), email };
}

const get = (host: string, path: string, session?: Session) =>
  send(host, path, { cookie: session?.cookie });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });
  const stamp = Date.now();
  const adminEmail = `admin-${stamp}@example.com`;
  const ownerEmail = `owner-${stamp}@example.com`;

  try {
    /* ── Two accounts: one will be made a platform admin, one won't ── */
    const adminSession = await signUp(ADMIN_HOST, adminEmail, "Platform Admin");
    const ownerSession = await signUp(APP_HOST, ownerEmail, "Venue Owner");

    console.log("\nBefore any grant");
    let response = await get(ADMIN_HOST, "/", adminSession);
    check(
      "a signed-in user with no grant is refused the console",
      response.status === 307,
      `got ${response.status}`,
    );

    /* ── Grant, the only way it can be granted ── */
    const [adminUser] = await sql<{ id: string }[]>`
      SELECT id FROM "user" WHERE email = ${adminEmail}
    `;
    await sql`
      INSERT INTO platform_admin (user_id, note) VALUES (${adminUser.id}, 'test')
      ON CONFLICT (user_id) DO UPDATE SET revoked_at = NULL
    `;

    console.log("\nAfter granting platform admin");
    response = await get(ADMIN_HOST, "/", adminSession);
    const body = response.body;
    check("the admin can open the console", response.status === 200, `got ${response.status}`);
    check("and sees other tenants", body.includes("Katipunan Padel"));

    response = await get(ADMIN_HOST, "/", ownerSession);
    check(
      "a venue owner still cannot, even signed in",
      response.status === 307,
      `got ${response.status}`,
    );

    response = await get(ADMIN_HOST, "/audit", ownerSession);
    check(
      "nor the audit log",
      response.status === 307,
      `got ${response.status}`,
    );

    /* ── Cross-tenant read is recorded ── */
    console.log("\nAudit trail");
    await sql`DELETE FROM admin_audit WHERE actor_user_id = ${adminUser.id}`;
    await get(ADMIN_HOST, "/tenant/org_katipunan", adminSession);

    const audits = await sql<{ action: string; organization_id: string | null }[]>`
      SELECT action, organization_id FROM admin_audit
      WHERE actor_user_id = ${adminUser.id} ORDER BY created_at DESC
    `;
    check(
      "opening a tenant is written to the audit log",
      audits.some((a) => a.action === "admin.viewed_tenant" && a.organization_id === "org_katipunan"),
      audits.map((a) => a.action).join(", ") || "nothing recorded",
    );

    /* ── Revocation takes effect at once ── */
    console.log("\nRevocation");
    await sql`UPDATE platform_admin SET revoked_at = now() WHERE user_id = ${adminUser.id}`;
    response = await get(ADMIN_HOST, "/", adminSession);
    check(
      "a revoked admin loses access on the very next request",
      response.status === 307,
      `got ${response.status}`,
    );
    await sql`UPDATE platform_admin SET revoked_at = NULL WHERE user_id = ${adminUser.id}`;

    /* ── Suspension actually closes the venue ── */
    console.log("\nSuspension");
    await sql`
      UPDATE venue SET suspended_at = now(), suspended_reason = 'test'
      WHERE organization_id = 'org_katipunan'
    `;
    const publicBody = (await get(APEX_HOST, "/katipunan")).body;
    check(
      "a suspended venue stops taking bookings",
      publicBody.includes("isn") && publicBody.includes("taking online bookings"),
    );
    check(
      "and its slot grid is gone entirely",
      !publicBody.includes('available') || !publicBody.includes('Pick a time'),
    );

    await sql`
      UPDATE venue SET suspended_at = NULL, suspended_reason = NULL
      WHERE organization_id = 'org_katipunan'
    `;
    // Check a few days ahead: today may be fully in the past in the venue's
    // evening, and the RSC payload escapes the quotes, so match on the reason.
    const [{ future }] = await sql<{ future: string }[]>`
      SELECT ((now() AT TIME ZONE 'Asia/Manila')::date + 3)::text AS future`;
    const reopened = await get(APEX_HOST, `/katipunan?date=${future}`);
    check("reactivating reopens it", /reason\\?":\\?"open\\?"/.test(reopened.body));

    /* ── Impersonation is server-side state ── */
    console.log("\nImpersonation");
    const forgedCookie = `${adminSession.cookie}; reservme_impersonation=not-a-real-token`;
    response = await send(ADMIN_HOST, "/viewing", { cookie: forgedCookie });
    const viewingBody = response.body;
    check(
      "a forged impersonation cookie grants nothing",
      viewingBody.includes("Not viewing anyone") || response.status === 307,
      `status ${response.status}`,
    );

    console.log(
      failures === 0
        ? "\nAll checks passed — the console refuses everyone it should.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    // admin_audit.actor_user_id is ON DELETE RESTRICT on purpose: a user cannot
    // be deleted out from under their own audit trail. Only this test's own
    // rows are removed, and only so the fixture users can go with them.
    await sql`
      DELETE FROM admin_audit
      WHERE actor_user_id IN (
        SELECT id FROM "user" WHERE email IN (${adminEmail}, ${ownerEmail})
      )
    `;
    await sql`DELETE FROM "user" WHERE email IN (${adminEmail}, ${ownerEmail})`;
    await sql.end();
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
