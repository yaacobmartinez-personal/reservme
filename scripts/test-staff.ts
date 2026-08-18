/**
 * Verifies the staff/team read layer + tenant scoping. The Better Auth
 * invite/accept mutations run over HTTP with a session, so they're exercised in
 * the browser pass; here we prove the reads that render the Team UI are correct
 * and org-scoped.
 *
 *   npm run test:staff        (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";

const ORG = "org_staff_test";
const OTHER = "org_staff_other";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { listMembers, listInvitations, getInvitationView } = await import("../src/lib/team");

  const uid = (s: string) => `user_${s}_${Date.now()}`;
  const mkUser = async (id: string, name: string, email: string) => {
    await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
              VALUES (${id}, ${name}, ${email}, true, now(), now())`;
  };
  const addMember = async (org: string, userId: string, role: string) => {
    await sql`INSERT INTO member (id, organization_id, user_id, role, created_at)
              VALUES (${"mem_" + Math.random().toString(36).slice(2)}, ${org}, ${userId}, ${role}, now())`;
  };

  const ownerId = uid("owner");
  const staffId = uid("staff");
  const otherOwnerId = uid("otherowner");
  const inviteId = "inv_" + Math.random().toString(36).slice(2);

  try {
    for (const id of [ORG, OTHER]) {
      await sql`DELETE FROM organization WHERE id = ${id}`;
      await sql`INSERT INTO organization (id, name, slug) VALUES (${id}, ${id}, ${id})`;
      await sql`INSERT INTO venue (organization_id) VALUES (${id})`;
    }
    await mkUser(ownerId, "Olive Owner", `${ownerId}@x.com`);
    await mkUser(staffId, "Sam Staff", `${staffId}@x.com`);
    await mkUser(otherOwnerId, "Otto Other", `${otherOwnerId}@x.com`);
    await addMember(ORG, ownerId, "owner");
    await addMember(OTHER, otherOwnerId, "owner");

    /* ── a pending invite ── */
    await sql`
      INSERT INTO invitation (id, organization_id, email, role, status, expires_at, inviter_id)
      VALUES (${inviteId}, ${ORG}, 'newstaff@x.com', 'member', 'pending', now() + interval '48 hours', ${ownerId})`;

    const invites = await listInvitations(ORG);
    check("pending invite is listed", invites.some((i) => i.id === inviteId && i.email === "newstaff@x.com"));
    check("invites are org-scoped", (await listInvitations(OTHER)).every((i) => i.id !== inviteId));

    const view = await getInvitationView(inviteId);
    check("invitation view resolves for the accept page",
      view?.email === "newstaff@x.com" && view.role === "member" && view.status === "pending" && view.organizationName === ORG);
    check("unknown invitation id → null", (await getInvitationView("inv_nope")) === null);

    /* ── members, owner first ── */
    let members = await listMembers(ORG);
    check("owner is a member", members.some((m) => m.userId === ownerId && m.role === "owner"));
    check("owner sorts first", members[0]?.role === "owner");

    /* ── accepting adds a member (what acceptInvitation does) ── */
    await addMember(ORG, staffId, "member");
    await sql`UPDATE invitation SET status = 'accepted' WHERE id = ${inviteId}`;
    members = await listMembers(ORG);
    check("accepted staff appears as a member", members.some((m) => m.userId === staffId && m.role === "member"));
    check("accepted invite drops out of pending", (await listInvitations(ORG)).every((i) => i.id !== inviteId));

    /* ── isolation ── */
    check("another org's members aren't listed",
      (await listMembers(OTHER)).every((m) => m.userId !== ownerId && m.userId !== staffId));

    console.log(
      failures === 0
        ? "\nStaff verified: invite + member reads, accept adds a member, org isolation.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER})`;
    await sql`DELETE FROM "user" WHERE id IN (${ownerId}, ${staffId}, ${otherOwnerId})`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
