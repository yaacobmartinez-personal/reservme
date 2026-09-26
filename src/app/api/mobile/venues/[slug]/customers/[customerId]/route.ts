import {
  contactProblem,
  customerDetail,
  customerSummaryById,
  setContact,
} from "@/lib/mobile/customer-json";
import { fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; customerId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GONE = "We couldn't find that customer.";

/**
 * GET — API-CONTRACT #21. The whole of V11 in one request: the customer, their
 * upcoming and past bookings, and the venue's notes about them.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug, customerId } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(customerId)) return notFound(GONE);

  const customer = await customerDetail(scope.organizationId, customerId, scope.timezone);
  return customer ? ok(customer) : notFound(GONE);
}

/**
 * PATCH — API-CONTRACT #22, `updateCustomerContact`.
 *
 * Name and phone only. Email is the `(organization_id, email)` identity key
 * the booking engine matches returning customers on, so editing it here would
 * either collide with another row or silently split one person into two.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { slug, customerId } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(customerId)) return notFound(GONE);

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    phone?: unknown;
  } | null;

  const problem = contactProblem(body?.name, body?.phone);
  if (problem) {
    return invalid(
      { [problem.startsWith("That phone") ? "phone" : "name"]: problem },
      problem,
    );
  }

  const changed = await setContact(
    scope.organizationId,
    customerId,
    body!.name as string,
    (body!.phone as string | undefined) ?? null,
  );
  if (!changed) return notFound(GONE);

  return ok({ customer: await customerSummaryById(scope.organizationId, customerId, scope.timezone) });
}
