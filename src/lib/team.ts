import { sql } from "@/db";

/**
 * Owner-side reads for staff/team management. Mutations go through Better Auth's
 * organization plugin (invite / accept / cancel / remove) on the client; these
 * just render the current members and pending invites.
 */

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
};

export type PendingInvite = {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
};

export async function listMembers(organizationId: string): Promise<TeamMember[]> {
  const rows = await sql<
    { user_id: string; name: string; email: string; role: string; created_at: Date }[]
  >`
    SELECT u.id AS user_id, u.name, u.email, m.role, m.created_at
    FROM member m
    JOIN "user" u ON u.id = m.user_id
    WHERE m.organization_id = ${organizationId}
    ORDER BY (m.role = 'owner') DESC, m.created_at
  `;
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    role: r.role,
    createdAt: r.created_at,
  }));
}

export async function listInvitations(organizationId: string): Promise<PendingInvite[]> {
  const rows = await sql<{ id: string; email: string; role: string; expires_at: Date }[]>`
    SELECT id, email, role, expires_at
    FROM invitation
    WHERE organization_id = ${organizationId} AND status = 'pending'
    ORDER BY expires_at DESC
  `;
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, expiresAt: r.expires_at }));
}

export type InvitationView = {
  email: string;
  role: string;
  status: string;
  organizationName: string;
  expiresAt: Date;
};

/** The invitation behind an accept link (for the accept page). */
export async function getInvitationView(id: string): Promise<InvitationView | null> {
  if (!id) return null;
  const [row] = await sql<
    { email: string; role: string; status: string; org_name: string; expires_at: Date }[]
  >`
    SELECT i.email, i.role, i.status, o.name AS org_name, i.expires_at
    FROM invitation i
    JOIN organization o ON o.id = i.organization_id
    WHERE i.id = ${id}
  `;
  if (!row) return null;
  return {
    email: row.email,
    role: row.role,
    status: row.status,
    organizationName: row.org_name,
    expiresAt: row.expires_at,
  };
}
