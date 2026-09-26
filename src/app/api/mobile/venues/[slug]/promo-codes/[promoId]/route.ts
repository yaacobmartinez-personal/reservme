import { promosJson } from "@/lib/mobile/growth-json";
import { setPromoActive } from "@/lib/promo";
import { fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; promoId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH — API-CONTRACT #44 `{active}`. */
export async function PATCH(request: Request, { params }: Params) {
  const { slug, promoId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(promoId)) return notFound("We couldn't find that code.");

  const body = (await request.json().catch(() => null)) as { active?: unknown } | null;
  if (typeof body?.active !== "boolean") return invalid({ active: "Say whether it's on or off." });

  const found = await setPromoActive(scope.organizationId, promoId, body.active);
  if (!found) return notFound("We couldn't find that code.");
  const code = (await promosJson(scope.organizationId)).codes.find((c) => c.id === promoId);
  return ok({ code });
}
