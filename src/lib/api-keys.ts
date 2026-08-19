import crypto from "node:crypto";
import { sql } from "@/db";

/**
 * API keys for the read API. Only the SHA-256 hash is stored; the full key is
 * shown once at creation. Verification hashes the presented key and matches a
 * non-revoked row, resolving the org.
 */

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
};

export async function listApiKeys(organizationId: string): Promise<ApiKeyRow[]> {
  const rows = await sql<
    {
      id: string;
      name: string;
      key_prefix: string;
      last_used_at: Date | null;
      created_at: Date;
      revoked_at: Date | null;
    }[]
  >`
    SELECT id, name, key_prefix, last_used_at, created_at, revoked_at
    FROM api_key
    WHERE organization_id = ${organizationId}
    ORDER BY (revoked_at IS NULL) DESC, created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.key_prefix,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
  }));
}

export async function createApiKey(
  organizationId: string,
  name: string,
): Promise<{ id: string; key: string }> {
  const key = `rk_live_${crypto.randomBytes(24).toString("base64url")}`;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO api_key (organization_id, name, key_prefix, key_hash)
    VALUES (${organizationId}, ${name}, ${key.slice(0, 14)}, ${hashKey(key)})
    RETURNING id
  `;
  return { id: row.id, key };
}

export async function revokeApiKey(organizationId: string, id: string): Promise<void> {
  await sql`
    UPDATE api_key SET revoked_at = now()
    WHERE id = ${id}::uuid AND organization_id = ${organizationId} AND revoked_at IS NULL
  `;
}

/** Resolves the org for a presented key, or null if unknown/revoked. */
export async function verifyApiKey(
  raw: string | null,
): Promise<{ organizationId: string } | null> {
  if (!raw || !raw.startsWith("rk_")) return null;
  const [row] = await sql<{ id: string; organization_id: string }[]>`
    SELECT id, organization_id FROM api_key
    WHERE key_hash = ${hashKey(raw)} AND revoked_at IS NULL
  `;
  if (!row) return null;
  await sql`UPDATE api_key SET last_used_at = now() WHERE id = ${row.id}::uuid`;
  return { organizationId: row.organization_id };
}

/** Pulls a bearer token out of an Authorization header. */
export function bearerFrom(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (!h || !h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim() || null;
}
