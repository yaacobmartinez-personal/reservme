import { reviewUrlProblem, setReviewUrl } from "@/lib/engagement";
import { marketingJson } from "@/lib/mobile/growth-json";
import { fail, invalid, ok } from "@/lib/mobile/respond";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** GET — API-CONTRACT #45. */
export async function GET(request: Request, { params }: Params) {
  const { slug } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  return ok(await marketingJson(scope.organizationId));
}

/**
 * PUT — API-CONTRACT #45 `{reviewUrl: string | null}`. Review requests go out
 * only once a link is set; clearing it stops them.
 */
export async function PUT(request: Request, { params }: Params) {
  const { slug } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const body = (await request.json().catch(() => null)) as { reviewUrl?: unknown } | null;
  const value = body?.reviewUrl ?? null;
  const problem = reviewUrlProblem(value);
  if (problem) return invalid({ reviewUrl: problem }, problem);
  await setReviewUrl(scope.organizationId, typeof value === "string" ? value : null);
  return ok(await marketingJson(scope.organizationId));
}
