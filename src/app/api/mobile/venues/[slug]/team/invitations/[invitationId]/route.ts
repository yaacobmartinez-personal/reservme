import { sql } from "@/db";
import { fail, fromAuthError, notFound, ok } from "@/lib/mobile/respond";
import { orgApi, teamJson } from "@/lib/mobile/team-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; invitationId: string }> };

const GONE = "That invitation is already gone.";

/**
 * DELETE — API-CONTRACT #31. Take an invitation back.
 *
 * The invitation is checked against *this* venue before it is cancelled: the
 * id alone would otherwise let an admin of one venue revoke an invite to
 * another, which Better Auth's own permission check would allow only because
 * it never sees which venue we meant.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { slug, invitationId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM invitation
    WHERE id = ${invitationId} AND organization_id = ${scope.organizationId}
      AND status = 'pending'
  `;
  if (!row) return notFound(GONE);

  try {
    await orgApi.cancelInvite(request.headers, invitationId);
  } catch (error) {
    return fromAuthError(error, "We couldn't cancel that invitation.");
  }

  return ok(await teamJson(scope.organizationId, scope.user.id, scope.role));
}
