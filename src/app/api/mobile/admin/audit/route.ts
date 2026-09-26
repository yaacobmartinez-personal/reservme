import { adminGate, auditJson } from "@/lib/mobile/admin-json";
import { ok } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

/** GET /api/mobile/admin/audit?limit= — API-CONTRACT #41. Newest first, max 200. */
export async function GET(request: Request) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
  return ok(await auditJson(Number.isFinite(limit) ? limit : 100));
}
