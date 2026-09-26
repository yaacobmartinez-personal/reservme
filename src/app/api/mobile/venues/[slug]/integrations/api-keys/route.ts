import { createApiKey } from "@/lib/api-keys";
import { integrationsJson } from "@/lib/mobile/growth-json";
import { fail, invalid, ok } from "@/lib/mobile/respond";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * POST — API-CONTRACT #46 `{name}`. The full key is in this response and
 * nowhere else, ever — only its hash is stored. `key` sits beside the refreshed
 * integrations so the app can show it once and then forget it.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return invalid({ name: "Name the key." }, "Name the key.");
  if (name.length > 60) return invalid({ name: "Keep the name under 60 characters." });

  const { key } = await createApiKey(scope.organizationId, name);
  return ok({ key, ...(await integrationsJson(scope.organizationId)) }, 201);
}
