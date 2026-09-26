import { adminGate, adminsJson } from "@/lib/mobile/admin-json";
import { ok } from "@/lib/mobile/respond";

export const dynamic = "force-dynamic";

/** GET /api/mobile/admin/admins — API-CONTRACT #41. */
export async function GET(request: Request) {
  const gate = await adminGate(request);
  if (gate.response) return gate.response;
  return ok(await adminsJson(gate.admin.user.id));
}
