import { z } from "zod";
import { integrationsJson } from "@/lib/mobile/growth-json";
import { fail, invalid, ok } from "@/lib/mobile/respond";
import { createWebhook, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const schema = z.object({
  url: z
    .string()
    .trim()
    .url("Enter a valid https URL.")
    .refine((u) => u.startsWith("https://"), "Enter a valid https URL."),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event."),
});

/**
 * POST — API-CONTRACT #46 `{url, events}`. https only: the body carries
 * customer details, and the signature proves who sent it, not who read it.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid({ [String(issue.path[0] ?? "url")]: issue.message }, issue.message);
  }
  await createWebhook(scope.organizationId, parsed.data.url, parsed.data.events);
  return ok(await integrationsJson(scope.organizationId), 201);
}
