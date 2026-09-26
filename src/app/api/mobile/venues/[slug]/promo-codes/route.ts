import { promosJson } from "@/lib/mobile/growth-json";
import { createPromo } from "@/lib/promo";
import { fail, invalid, ok } from "@/lib/mobile/respond";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** GET — API-CONTRACT #44. Active first, newest first. */
export async function GET(request: Request, { params }: Params) {
  const { slug } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  return ok(await promosJson(scope.organizationId));
}

/**
 * POST — API-CONTRACT #44 `{code, kind: "percent"|"amount", value, maxUses?,
 * expiresAt? ("YYYY-MM-DD", venue-local, inclusive)}`. `value` is a
 * percentage or whole pesos.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const result = await createPromo(
    scope.organizationId,
    scope.timezone,
    await request.json().catch(() => ({})),
  );
  if (!result.ok) return invalid({ [result.field]: result.message }, result.message);
  const code = (await promosJson(scope.organizationId)).codes.find((c) => c.id === result.id);
  return ok({ code }, 201);
}
