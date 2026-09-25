import { fail, fromAuthError, invalid, ok } from "@/lib/mobile/respond";
import { inviteProblem, orgApi, teamJson } from "@/lib/mobile/team-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * POST — API-CONTRACT #31. Invite somebody in.
 *
 * Goes through Better Auth's organization plugin rather than writing the
 * `invitation` row directly, so the email, the 48-hour expiry and the accept
 * page all keep working as they already do.
 *
 * Only an owner may hand out `owner`. An admin can build a team; giving away
 * the venue is the owner's alone.
 */
export async function POST(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const problem = inviteProblem(body.email, body.role);
  if (problem) {
    return invalid({ [problem === "That isn't a role." ? "role" : "email"]: problem }, problem);
  }

  const role = typeof body.role === "string" ? body.role : "member";
  if (role === "owner" && scope.role !== "owner") {
    return fail(403, {
      error: "denied",
      message: "Only an owner can invite another owner.",
    });
  }

  try {
    await orgApi.invite(
      request.headers,
      scope.organizationId,
      String(body.email).trim().toLowerCase(),
      role,
    );
  } catch (error) {
    // Better Auth refuses a duplicate invite and an existing member in its own
    // words; passing those through beats inventing a second vocabulary.
    return fromAuthError(error, "We couldn't send that invitation.");
  }

  return ok(await teamJson(scope.organizationId, scope.user.id, scope.role), 201);
}
