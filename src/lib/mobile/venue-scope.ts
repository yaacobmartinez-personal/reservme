import { sql } from "@/db";
import { mobileUser, type MobileUser } from "@/lib/mobile/session";

export type Role = "owner" | "admin" | "member";

/** Structural writes — spaces, hours, settings, branding. */
export const MANAGE: Role[] = ["owner", "admin"];

export type VenueScope = {
  organizationId: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  role: Role;
  user: MobileUser;
};

export type ScopeFailure = { status: 401 | 403 | 404; message: string };

/**
 * Resolves `{slug}` to a venue **this user belongs to**, or says why not.
 *
 * The organisation id comes from the membership row, never from the request —
 * the route param only selects among venues the caller already has. That is the
 * same rule `currentVenue()` follows on the web, and it is the reason a
 * mistyped or guessed slug cannot reach another tenant's data.
 *
 * A venue the user is not a member of answers **404, not 403**: 403 would
 * confirm the venue exists, which turns this into a directory of every venue on
 * the platform.
 */
export async function venueScope(
  request: Request,
  slug: string,
  allowed: Role[] = ["owner", "admin", "member"],
): Promise<VenueScope | ScopeFailure> {
  const user = await mobileUser(request);
  if (!user) return { status: 401, message: "Sign in again to continue." };

  const [row] = await sql<
    {
      organization_id: string;
      slug: string;
      name: string;
      timezone: string;
      currency: string;
      role: string;
    }[]
  >`
    SELECT o.id AS organization_id, o.slug, o.name, v.timezone, v.currency, m.role
    FROM member m
    JOIN organization o ON o.id = m.organization_id
    JOIN venue v        ON v.organization_id = o.id
    WHERE m.user_id = ${user.id} AND lower(o.slug) = ${slug.toLowerCase()}
    LIMIT 1
  `;

  if (!row) return { status: 404, message: "We couldn't find that venue." };

  const role: Role = row.role === "owner" || row.role === "admin" ? row.role : "member";
  if (!allowed.includes(role)) {
    return {
      status: 403,
      // Named rather than generic: a member who cannot change a space should
      // know it is their role, not a bug or a broken session.
      message: "Only an owner or admin can change this.",
    };
  }

  return {
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    currency: row.currency,
    role,
    user,
  };
}

export function isFailure(scope: VenueScope | ScopeFailure): scope is ScopeFailure {
  return "status" in scope;
}
