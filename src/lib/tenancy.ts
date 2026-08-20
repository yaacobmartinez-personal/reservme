import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { auth } from "@/lib/auth";
import { currentImpersonation } from "@/lib/admin/impersonation";

export type Role = "owner" | "admin" | "member";

export type ActiveVenue = {
  organizationId: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  role: Role;
  /**
   * Set when a platform admin is viewing this venue rather than a member of it.
   * Anything that writes must pass this to the audit log, and the UI must make
   * it impossible to forget you are not yourself.
   */
  impersonatedBy?: { userId: string; name: string; expiresAt: Date };
};

/**
 * The single place the active organisation is resolved.
 *
 * Every tenant-scoped query takes its organizationId from here rather than
 * from a route param or a form field. Trusting the caller for the tenant is
 * how cross-tenant leaks happen, and it only has to be got wrong once.
 */
export async function currentVenue(): Promise<ActiveVenue | null> {
  // A platform admin impersonating a venue sees that venue's real app. The
  // impersonation cookie is a DB-validated bearer capability —
  // currentImpersonation() re-checks the token, expiry and the admin grant on
  // every call — so it needs no app-host login and a revoked admin loses it at
  // once. Checked first, before any session, so it works on whichever host
  // carries the cookie.
  const impersonation = await currentImpersonation();
  if (impersonation) {
    const [venue] = await sql<
      { name: string; slug: string; timezone: string; currency: string }[]
    >`
      SELECT o.name, o.slug, v.timezone, v.currency
      FROM organization o
      JOIN venue v ON v.organization_id = o.id
      WHERE o.id = ${impersonation.organizationId}
    `;

    if (venue) {
      return {
        organizationId: impersonation.organizationId,
        name: venue.name,
        slug: venue.slug,
        timezone: venue.timezone,
        currency: venue.currency,
        // Impersonation is for seeing what an owner sees, not for gaining
        // powers they don't have.
        role: "owner",
        impersonatedBy: {
          userId: impersonation.adminUserId,
          name: impersonation.adminName,
          expiresAt: impersonation.expiresAt,
        },
      };
    }
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  // Fall back to the user's first membership when no org is active yet, so a
  // fresh login lands somewhere useful instead of a chooser.
  const [row] = await sql<
    {
      organization_id: string;
      name: string;
      slug: string;
      timezone: string;
      currency: string;
      role: Role;
    }[]
  >`
    SELECT o.id AS organization_id, o.name, o.slug,
           v.timezone, v.currency, m.role
    FROM member m
    JOIN organization o ON o.id = m.organization_id
    JOIN venue v        ON v.organization_id = o.id
    WHERE m.user_id = ${session.user.id}
    ORDER BY (o.id = ${session.session.activeOrganizationId ?? ""}) DESC,
             m.created_at ASC
    LIMIT 1
  `;

  if (!row) return null;

  return {
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    currency: row.currency,
    role: row.role,
  };
}

/** Dashboard pages call this; it redirects rather than returning null. */
export async function requireVenue(): Promise<ActiveVenue> {
  const venue = await currentVenue();
  if (!venue) redirect("/login");
  return venue;
}

export async function requireRole(...allowed: Role[]): Promise<ActiveVenue> {
  const venue = await requireVenue();
  if (!allowed.includes(venue.role)) redirect("/");
  return venue;
}
