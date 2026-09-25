import { sql } from "@/db";
import { auth } from "@/lib/auth";

export type MobileUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
};

export type VenueMembership = {
  orgId: string;
  slug: string;
  name: string;
  role: "owner" | "admin" | "member";
  timezone: string;
  currency: string;
  theme: string;
  suspended: boolean;
  activeSpaces: number;
};

/**
 * The signed-in staff account behind a `/api/mobile/*` request, or null.
 *
 * The bearer plugin has already turned `Authorization: Bearer <token>` into
 * the cookie `getSession` reads, so this is the same session the web has —
 * one session table, one revocation path, no second token format to keep
 * honest.
 *
 * Note it takes the request's headers rather than `next/headers`: a route
 * handler gets the real ones, and reading the ambient store would quietly
 * work on the web and return nothing here.
 */
export async function mobileUser(request: Request): Promise<MobileUser | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    emailVerified: Boolean(session.user.emailVerified),
  };
}

export function userJson(user: MobileUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
  };
}

/**
 * Every venue this user belongs to, shaped as API-CONTRACT `VenueMembership`.
 *
 * `activeSpaces` rides along because the app derives the billing band from it
 * and shows it on the venue picker; counting it here saves a request per venue
 * on a screen that already has all the rows.
 */
export async function membershipsFor(userId: string): Promise<VenueMembership[]> {
  const rows = await sql<
    {
      org_id: string;
      slug: string;
      name: string;
      role: string;
      timezone: string;
      currency: string;
      theme: string;
      suspended_at: Date | null;
      active_spaces: number;
    }[]
  >`
    SELECT o.id AS org_id, o.slug, o.name, m.role,
           v.timezone, v.currency, v.theme, v.suspended_at,
           (SELECT count(*)::int FROM space s
             WHERE s.organization_id = o.id AND s.is_active) AS active_spaces
    FROM member m
    JOIN organization o ON o.id = m.organization_id
    JOIN venue v        ON v.organization_id = o.id
    WHERE m.user_id = ${userId}
    ORDER BY m.created_at ASC
  `;

  return rows.map((r) => ({
    orgId: r.org_id,
    slug: r.slug,
    name: r.name,
    // The column is free text in Better Auth's schema; anything we don't
    // recognise is the least-privileged role rather than a parse failure.
    role: r.role === "owner" || r.role === "admin" ? r.role : "member",
    timezone: r.timezone,
    currency: r.currency,
    theme: r.theme,
    suspended: r.suspended_at !== null,
    activeSpaces: r.active_spaces,
  }));
}
