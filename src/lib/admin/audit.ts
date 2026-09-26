import { headers } from "next/headers";
import { sql } from "@/db";

export type AdminAction =
  | "admin.viewed_tenant"
  | "admin.suspended_venue"
  | "admin.reactivated_venue"
  | "admin.impersonation_started"
  | "admin.impersonation_ended"
  | "admin.granted_admin"
  | "admin.revoked_admin"
  | "admin.approved_payment"
  | "admin.rejected_payment"
  | "admin.marked_paid"
  | "admin.comped"
  | "admin.cancelled_subscription"
  | "admin.updated_billing_config"
  | "admin.emailed_tenant";

/**
 * Records a privileged action.
 *
 * `actorUserId` is always the real human. When something is done while
 * impersonating a venue, `impersonating` is set and the actor stays the admin —
 * impersonation must never be a way to attribute an action to someone else.
 */
/** The request an admin action arrived on, for the audit trail. */
export type AdminOrigin = { ip: string | null; userAgent: string | null };

export function originFrom(requestHeaders: Headers): AdminOrigin {
  return {
    ip:
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      requestHeaders.get("x-real-ip") ??
      null,
    userAgent: requestHeaders.get("user-agent"),
  };
}

export async function recordAdminAction(input: {
  actorUserId: string;
  action: AdminAction;
  organizationId?: string | null;
  target?: string | null;
  impersonating?: boolean;
  detail?: Record<string, unknown>;
  /**
   * Where the action came from. A server action omits it and it is read from
   * the request; the mobile API and tests pass it, since they have the
   * `Request` in hand and no ambient request to read.
   */
  origin?: AdminOrigin;
}): Promise<void> {
  const origin = input.origin ?? originFrom(await headers());
  const ip = origin.ip;
  // sql.json, not JSON.stringify: postgres.js encodes a jsonb parameter
  // itself, so a pre-stringified value was stored as a JSON *string* and every
  // reader saw "{...}" where it expected an object.
  const detail = input.detail
    ? sql.json(input.detail as Parameters<typeof sql.json>[0])
    : null;

  await sql`
    INSERT INTO admin_audit
      (actor_user_id, action, organization_id, target, impersonating, detail, ip, user_agent)
    VALUES (
      ${input.actorUserId},
      ${input.action},
      ${input.organizationId ?? null},
      ${input.target ?? null},
      ${input.impersonating ?? false},
      ${detail},
      ${ip},
      ${origin.userAgent}
    )
  `;
}

export type AuditEntry = {
  id: string;
  actorName: string;
  actorEmail: string;
  action: string;
  organizationName: string | null;
  target: string | null;
  impersonating: boolean;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: Date;
};

/**
 * Rows written before the jsonb fix hold their detail as a JSON string. Read
 * both, so the trail from before the fix still shows its reasons.
 */
function parseDetail(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

export async function getAuditLog(limit = 100): Promise<AuditEntry[]> {
  const rows = await sql<
    {
      id: string;
      actor_name: string;
      actor_email: string;
      action: string;
      organization_name: string | null;
      target: string | null;
      impersonating: boolean;
      detail: unknown;
      ip: string | null;
      created_at: Date;
    }[]
  >`
    SELECT a.id, u.name AS actor_name, u.email AS actor_email, a.action,
           o.name AS organization_name, a.target, a.impersonating,
           a.detail, a.ip, a.created_at
    FROM admin_audit a
    JOIN "user" u ON u.id = a.actor_user_id
    LEFT JOIN organization o ON o.id = a.organization_id
    ORDER BY a.created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    action: row.action,
    organizationName: row.organization_name,
    target: row.target,
    impersonating: row.impersonating,
    detail: parseDetail(row.detail),
    ip: row.ip,
    createdAt: row.created_at,
  }));
}
