import { auth } from "@/lib/auth";
import { listInvitations, listMembers } from "@/lib/team";
import type { Role } from "@/lib/mobile/venue-scope";

/**
 * The team, shaped for the app (API-CONTRACT #31).
 *
 * The reads are `listMembers` / `listInvitations` verbatim. The writes go
 * through Better Auth's organization plugin — the same path the web's client
 * takes — rather than touching `member` and `invitation` directly, so
 * invitation emails, expiry and acceptance keep working the way they already
 * do.
 *
 * What is *not* in Better Auth is the **last-owner guard**, and it belongs
 * here: demoting or removing the only owner leaves a venue nobody can hand
 * over, invite into, or bill. That is not recoverable from inside the app.
 */

export type TeamJson = Awaited<ReturnType<typeof teamJson>>;

export async function teamJson(
  organizationId: string,
  userId: string,
  yourRole: Role,
) {
  const [members, invitations] = await Promise.all([
    listMembers(organizationId),
    listInvitations(organizationId),
  ]);

  return {
    members: members.map((m) => ({
      id: m.memberId,
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      // So the screen can say "you" rather than making somebody work it out
      // from an email address they may not recognise as their own.
      isSelf: m.userId === userId,
      joinedAt: m.createdAt.toISOString(),
    })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
    })),
    // What this caller may do, so the screen explains rather than hides.
    yourRole,
  };
}

export function inviteProblem(email: unknown, role: unknown): string | null {
  if (typeof email !== "string" || !email.trim()) return "Who are you inviting?";
  // The app's own `InviteInput` pattern, so both surfaces refuse the same
  // address for the same reason.
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email.trim())) {
    return "That email doesn't look right.";
  }
  if (role != null && !["owner", "admin", "member"].includes(String(role))) {
    return "That isn't a role.";
  }
  return null;
}

/**
 * Counts owners, and says whether this member is the last of them.
 *
 * Self-changes are allowed on purpose. An owner handing the venue on and
 * stepping down is a real thing, and since only an owner can demote an owner,
 * forbidding it outright would make this guard unreachable — which is exactly
 * how the first version of it went wrong.
 */
export async function wouldStrandVenue(
  organizationId: string,
  memberId: string,
): Promise<boolean> {
  const members = await listMembers(organizationId);
  const target = members.find((m) => m.memberId === memberId);
  if (!target || target.role !== "owner") return false;
  return members.filter((m) => m.role === "owner").length <= 1;
}

export function memberOf(members: { memberId: string; email: string }[], memberId: string) {
  return members.find((m) => m.memberId === memberId) ?? null;
}

/**
 * Better Auth's organization endpoints, called server-side with the caller's
 * own headers so the plugin sees the real session.
 *
 * `removeMember` takes an email rather than an id (`memberIdOrEmail`), which
 * is what the web's client passes too.
 */
export const orgApi = {
  invite: (headers: Headers, organizationId: string, email: string, role: string) =>
    auth.api.createInvitation({
      headers,
      body: { email, role: role as "owner" | "admin" | "member", organizationId },
    }),

  cancelInvite: (headers: Headers, invitationId: string) =>
    auth.api.cancelInvitation({ headers, body: { invitationId } }),

  setRole: (headers: Headers, organizationId: string, memberId: string, role: string) =>
    auth.api.updateMemberRole({
      headers,
      body: { memberId, role: role as "owner" | "admin" | "member", organizationId },
    }),

  remove: (headers: Headers, organizationId: string, memberIdOrEmail: string) =>
    auth.api.removeMember({ headers, body: { memberIdOrEmail, organizationId } }),
};
