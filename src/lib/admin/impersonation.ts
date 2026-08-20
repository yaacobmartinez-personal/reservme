import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "@/db";

export const IMPERSONATION_COOKIE = "reservme_impersonation";

/** Deliberately short. Support work is minutes, not days. */
export const IMPERSONATION_MINUTES = 30;

export type Impersonation = {
  token: string;
  adminUserId: string;
  adminName: string;
  organizationId: string;
  organizationName: string;
  expiresAt: Date;
};

/**
 * Resolves the active impersonation, if any.
 *
 * The cookie carries an opaque token and nothing else — no organisation id, no
 * admin id, no expiry. Every one of those is read from the database here, so a
 * tampered or stale cookie resolves to nothing, and ending a session takes
 * effect on the very next request.
 */
export async function currentImpersonation(): Promise<Impersonation | null> {
  const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  if (!token) return null;
  return resolveImpersonation(token);
}

/**
 * Validates an impersonation token against the database — active, unexpired, and
 * the admin's grant still live. Shared by the cookie reader and the app-host
 * hand-off route, so a token is trusted the same way wherever it arrives.
 */
export async function resolveImpersonation(token: string): Promise<Impersonation | null> {
  const [row] = await sql<
    {
      token: string;
      admin_user_id: string;
      admin_name: string;
      organization_id: string;
      organization_name: string;
      expires_at: Date;
    }[]
  >`
    SELECT i.token, i.admin_user_id, u.name AS admin_name,
           i.organization_id, o.name AS organization_name, i.expires_at
    FROM admin_impersonation i
    JOIN "user" u        ON u.id = i.admin_user_id
    JOIN organization o  ON o.id = i.organization_id
    WHERE i.token = ${token}
      AND i.ended_at IS NULL
      AND i.expires_at > now()
      -- Re-check the grant. An admin whose access was revoked mid-session
      -- must not keep an open impersonation as a back door.
      AND EXISTS (
        SELECT 1 FROM platform_admin pa
        WHERE pa.user_id = i.admin_user_id AND pa.revoked_at IS NULL
      )
  `;

  if (!row) return null;

  return {
    token: row.token,
    adminUserId: row.admin_user_id,
    adminName: row.admin_name,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    expiresAt: row.expires_at,
  };
}

export async function startImpersonation(input: {
  adminUserId: string;
  organizationId: string;
  reason?: string;
}): Promise<string> {
  // One at a time. Two open sessions makes "which venue am I looking at?"
  // ambiguous, which is exactly the confusion that causes a wrong edit.
  await sql`
    UPDATE admin_impersonation
       SET ended_at = now()
     WHERE admin_user_id = ${input.adminUserId} AND ended_at IS NULL
  `;

  const token = randomBytes(32).toString("base64url");

  await sql`
    INSERT INTO admin_impersonation (token, admin_user_id, organization_id, reason, expires_at)
    VALUES (
      ${token}, ${input.adminUserId}, ${input.organizationId}, ${input.reason ?? null},
      now() + make_interval(mins => ${IMPERSONATION_MINUTES})
    )
  `;

  // The cookie is not set here: it is set on the APP host by the hand-off route
  // (/api/impersonate), so a platform admin views the tenant's real dashboard
  // there. Keeping it host-only on the app host means the apex booking pages
  // never carry it.
  return token;
}

/** Sets the impersonation cookie on the current host (the app-host hand-off). */
export async function setImpersonationCookie(token: string): Promise<void> {
  (await cookies()).set(IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: IMPERSONATION_MINUTES * 60,
  });
}

export async function endImpersonation(): Promise<Impersonation | null> {
  const active = await currentImpersonation();

  const store = await cookies();
  const token = store.get(IMPERSONATION_COOKIE)?.value;

  if (token) {
    await sql`
      UPDATE admin_impersonation
         SET ended_at = now()
       WHERE token = ${token} AND ended_at IS NULL
    `;
  }

  store.delete(IMPERSONATION_COOKIE);
  return active;
}
