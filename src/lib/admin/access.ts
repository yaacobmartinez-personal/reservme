import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { auth } from "@/lib/auth";

export type PlatformAdmin = {
  userId: string;
  name: string;
  email: string;
};

/**
 * Platform admin status is read from the database on every request, never
 * cached in the session or trusted from a cookie. Revoking a grant has to take
 * effect immediately, not whenever someone's session happens to expire.
 */
export async function currentPlatformAdmin(): Promise<PlatformAdmin | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const [row] = await sql<{ user_id: string; name: string; email: string }[]>`
    SELECT pa.user_id, u.name, u.email
    FROM platform_admin pa
    JOIN "user" u ON u.id = pa.user_id
    WHERE pa.user_id = ${session.user.id}
      AND pa.revoked_at IS NULL
  `;

  if (!row) return null;
  return { userId: row.user_id, name: row.name, email: row.email };
}

/**
 * Every admin page and every admin action starts here.
 *
 * Redirects rather than 404s so a legitimate admin who is simply logged out
 * gets somewhere useful; a logged-in non-admin lands on the login page too,
 * which tells them nothing about whether the console exists.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await currentPlatformAdmin();
  if (!admin) redirect("/login");
  return admin;
}
