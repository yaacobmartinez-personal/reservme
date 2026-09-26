import { sql } from "@/db";
import { auth } from "@/lib/auth";
import { conflict, ok, unauthorized } from "@/lib/mobile/respond";
import { isPlatformAdmin } from "@/lib/mobile/admin-json";
import { membershipsFor, mobileUser, userJson } from "@/lib/mobile/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/me — API-CONTRACT #13.
 *
 * `{user, venues}`. The app calls this on every boot to refresh memberships:
 * a role change or a revoked membership has to reach the phone without a
 * re-login, and this is the only thing that carries it.
 */
export async function GET(request: Request) {
  const user = await mobileUser(request);
  if (!user) return unauthorized();

  // `platformAdmin` shows the app its Admin entry; every admin route still
  // checks for itself.
  const [venues, platformAdmin] = await Promise.all([
    membershipsFor(user.id),
    isPlatformAdmin(user.id),
  ]);
  return ok({ user: userJson(user), venues, platformAdmin });
}

/**
 * DELETE /api/mobile/me — API-CONTRACT #34.
 *
 * Refused with 409 `sole_owner` when the account is the only owner of a venue,
 * naming them. A venue with no owner has nobody who can pay for it, invite
 * anyone, or hand it on — so the fix is to make someone else an owner first,
 * not to let us orphan it.
 *
 * What goes: the login, the memberships, and the notes this user wrote. What
 * stays: every booking and customer, which belong to the venue and are its
 * records, not this person's.
 */
export async function DELETE(request: Request) {
  const user = await mobileUser(request);
  if (!user) return unauthorized();

  const stranded = await sql<{ slug: string; name: string }[]>`
    SELECT o.slug, o.name
    FROM member m
    JOIN organization o ON o.id = m.organization_id
    WHERE m.user_id = ${user.id} AND m.role = 'owner'
      AND NOT EXISTS (
        SELECT 1 FROM member other
        WHERE other.organization_id = m.organization_id
          AND other.role = 'owner'
          AND other.user_id <> ${user.id}
      )
    ORDER BY o.name
  `;

  if (stranded.length > 0) {
    const names = stranded.map((v) => v.name).join(", ");
    return conflict(
      "sole_owner",
      stranded.length === 1
        ? `You're the only owner of ${names}. Make someone else an owner first.`
        : `You're the only owner of ${names}. Make someone else an owner of each first.`,
      { venues: stranded.map((v) => v.slug) },
    );
  }

  // The schema already says what should survive: `member`, `session` and
  // `account` cascade from "user", while `customer_note.author_user_id` is
  // ON DELETE SET NULL — so the venue keeps what a staff member wrote about a
  // customer and loses only the attribution. One statement, no cleanup list to
  // fall out of date.
  await sql`DELETE FROM "user" WHERE id = ${user.id}`;

  try {
    await auth.api.signOut({ headers: request.headers });
  } catch {
    // The session row is already gone with the user.
  }

  return ok({ ok: true });
}
