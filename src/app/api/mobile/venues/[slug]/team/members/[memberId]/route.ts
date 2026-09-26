import { conflict, fail, fromAuthError, invalid, notFound, ok } from "@/lib/mobile/respond";
import { orgApi, teamJson, wouldStrandVenue } from "@/lib/mobile/team-json";
import { listMembers } from "@/lib/team";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; memberId: string }> };

const GONE = "We couldn't find that person on this team.";

const STRANDED =
  "That would leave the venue with no owner. Make someone else an owner first.";

/**
 * PATCH — change a role. DELETE — take someone off the team. API-CONTRACT #31.
 *
 * Both run the same guard: the venue must still have an owner afterwards.
 * Better Auth does not check this, and it is not recoverable from inside the
 * app — an ownerless venue cannot be handed over, invited into, or billed.
 *
 * Changing your **own** role is allowed. An owner handing the venue on and
 * stepping down is a real thing, and since only an owner can demote an owner,
 * forbidding it outright would make this guard unreachable dead code — which
 * is how the first version of this rule went wrong.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { slug, memberId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const body = ((await request.json().catch(() => null)) ?? {}) as { role?: unknown };
  const role = String(body.role ?? "");
  if (!["owner", "admin", "member"].includes(role)) {
    return invalid({ role: "That isn't a role." }, "That isn't a role.");
  }

  const members = await listMembers(scope.organizationId);
  const target = members.find((m) => m.memberId === memberId);
  if (!target) return notFound(GONE);

  if (role === "owner" && scope.role !== "owner") {
    return fail(403, { error: "denied", message: "Only an owner can make someone an owner." });
  }
  if (role !== "owner" && (await wouldStrandVenue(scope.organizationId, memberId))) {
    return conflict("last_owner", STRANDED);
  }

  try {
    await orgApi.setRole(request.headers, scope.organizationId, memberId, role);
  } catch (error) {
    return fromAuthError(error, "We couldn't change that role.");
  }

  return ok(await teamJson(scope.organizationId, scope.user.id, scope.role));
}

export async function DELETE(request: Request, { params }: Params) {
  const { slug, memberId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const members = await listMembers(scope.organizationId);
  const target = members.find((m) => m.memberId === memberId);
  if (!target) return notFound(GONE);

  if (target.role === "owner" && scope.role !== "owner") {
    return fail(403, { error: "denied", message: "Only an owner can remove an owner." });
  }
  if (await wouldStrandVenue(scope.organizationId, memberId)) {
    return conflict("last_owner", STRANDED);
  }

  try {
    // Better Auth takes `memberIdOrEmail`; the email is what the web passes.
    await orgApi.remove(request.headers, scope.organizationId, target.email);
  } catch (error) {
    return fromAuthError(error, "We couldn't remove that person.");
  }

  return ok(await teamJson(scope.organizationId, scope.user.id, scope.role));
}
