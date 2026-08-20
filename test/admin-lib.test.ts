/**
 * Covers the request-context-free admin logic: getAuditLog (read) and the
 * impersonation token model (start / resolve / one-at-a-time / grant re-check).
 * The request-scoped pieces (currentPlatformAdmin, recordAdminAction, the cookie
 * readers) need Next headers()/cookies() and are covered by the HTTP admin suite.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ORG = "org_admin_lib_test";
const ADMIN = "user_admin_lib_test";
const TARGET = `tenant_admin_lib_${Date.now()}`;
const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });

async function cleanup() {
  await sql`DELETE FROM admin_audit WHERE actor_user_id = ${ADMIN}`;
  await sql`DELETE FROM admin_impersonation WHERE admin_user_id = ${ADMIN}`;
  await sql`DELETE FROM organization WHERE id = ${ORG}`;
  await sql`DELETE FROM "user" WHERE id = ${ADMIN}`;
}

beforeAll(async () => {
  await cleanup();
  await sql`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES (${ADMIN}, 'Admin Ana', 'ana.admin@example.com', true, now(), now())`;
  await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Admin Lib Test', 'admin-lib-test')`;
  await sql`INSERT INTO platform_admin (user_id) VALUES (${ADMIN})`;
  await sql`
    INSERT INTO admin_audit (actor_user_id, action, organization_id, target)
    VALUES (${ADMIN}, 'admin.viewed_tenant', ${ORG}, ${TARGET})`;
});

afterAll(cleanup);

describe("getAuditLog", () => {
  it("joins the actor and organization onto the entry", async () => {
    const { getAuditLog } = await import("@/lib/admin/audit");
    const entry = (await getAuditLog(200)).find((e) => e.target === TARGET);
    expect(entry).toBeDefined();
    expect(entry?.actorName).toBe("Admin Ana");
    expect(entry?.actorEmail).toBe("ana.admin@example.com");
    expect(entry?.action).toBe("admin.viewed_tenant");
    expect(entry?.organizationName).toBe("Admin Lib Test");
    expect(entry?.impersonating).toBe(false);
  });
});

describe("impersonation tokens", () => {
  it("starts a session and resolves the token to the tenant", async () => {
    const { startImpersonation, resolveImpersonation } = await import(
      "@/lib/admin/impersonation"
    );
    const token = await startImpersonation({ adminUserId: ADMIN, organizationId: ORG });
    const resolved = await resolveImpersonation(token);
    expect(resolved).not.toBeNull();
    expect(resolved?.organizationId).toBe(ORG);
    expect(resolved?.organizationName).toBe("Admin Lib Test");
    expect(resolved?.adminName).toBe("Admin Ana");
  });

  it("rejects an unknown token", async () => {
    const { resolveImpersonation } = await import("@/lib/admin/impersonation");
    expect(await resolveImpersonation("not-a-real-token")).toBeNull();
  });

  it("allows only one open session — starting again ends the previous", async () => {
    const { startImpersonation, resolveImpersonation } = await import(
      "@/lib/admin/impersonation"
    );
    const first = await startImpersonation({ adminUserId: ADMIN, organizationId: ORG });
    const second = await startImpersonation({ adminUserId: ADMIN, organizationId: ORG });
    expect(await resolveImpersonation(first)).toBeNull();
    expect(await resolveImpersonation(second)).not.toBeNull();
  });

  it("stops resolving once the admin's grant is revoked", async () => {
    const { startImpersonation, resolveImpersonation } = await import(
      "@/lib/admin/impersonation"
    );
    const token = await startImpersonation({ adminUserId: ADMIN, organizationId: ORG });
    expect(await resolveImpersonation(token)).not.toBeNull();

    await sql`UPDATE platform_admin SET revoked_at = now() WHERE user_id = ${ADMIN}`;
    expect(await resolveImpersonation(token)).toBeNull();

    // Restore for any later assertions in this file.
    await sql`UPDATE platform_admin SET revoked_at = NULL WHERE user_id = ${ADMIN}`;
  });
});
