import { z } from "zod";
import { sql } from "@/db";
import { apexUrl } from "@/lib/env";
import { fail, invalid, notFound, ok } from "@/lib/mobile/respond";
import { isResolvableTimezone } from "@/lib/mobile/venue-input";
import { venueSettings } from "@/lib/mobile/venue-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const THEMES = ["pine", "ocean", "violet", "sunset", "rose", "slate"] as const;

/**
 * Every field optional, on purpose. This one endpoint serves two callers that
 * send different halves of it: the settings screen saves the whole form in one
 * write, because that is one transaction on the server; onboarding's "go live"
 * sends only the four policy fields, because that is the only thing O6 asked
 * about. A schema that required `name` would refuse the second.
 */
const patchSchema = z.object({
  name: z.string().trim().min(1, "Give your venue a name.").max(120).optional(),
  tagline: z.string().trim().max(200).nullish(),
  address: z.string().trim().max(200).nullish(),
  timezone: z.string().trim().min(1).max(64).optional(),
  currency: z.string().trim().length(3).optional(),
  theme: z.enum(THEMES).optional(),
  minNoticeMinutes: z.coerce.number().int().min(0).max(20160).optional(),
  maxHorizonDays: z.coerce.number().int().min(1).max(365).optional(),
  cancellationMode: z.enum(["anytime", "grace", "never"]).optional(),
  cancellationGraceHours: z.coerce.number().int().min(0).max(720).optional(),
  refundTerms: z.string().trim().max(1000).nullish(),
  gcashName: z.string().trim().max(120).nullish(),
});

/** "" means "cleared" the way the app sends it; undefined means "not sent". */
const orNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null || value.trim() === "" ? null : value.trim();

/**
 * PATCH /api/mobile/venues/{slug} — API-CONTRACT #30, and O7's "go live".
 *
 * → `{venue: VenueSettings, bookingUrl, spaceName}`. The two extras are what
 * the live screen needs: the address to copy onto a poster, and the space it
 * just set up, so O7 can name it rather than saying "your space".
 *
 * The booking-page slug is deliberately NOT editable here. It is printed on QR
 * codes and sits in every confirmation email already sent; changing it silently
 * breaks all of them.
 */
export async function PATCH(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid({ [String(issue.path[0] ?? "name")]: issue.message }, issue.message);
  }
  const input = parsed.data;

  // A zone we cannot resolve would make every rendered time quietly wrong
  // rather than obviously broken — the app refuses this too, in these words.
  if (input.timezone !== undefined && !isResolvableTimezone(input.timezone)) {
    return invalid({ timezone: "We don't know that timezone." });
  }

  const tagline = orNull(input.tagline);
  const address = orNull(input.address);
  const refundTerms = orNull(input.refundTerms);
  const gcashName = orNull(input.gcashName);

  await sql.begin(async (tx) => {
    if (input.name !== undefined) {
      await tx`UPDATE organization SET name = ${input.name} WHERE id = ${scope.organizationId}`;
    }
    // COALESCE keeps an unsent field at its current value while still letting an
    // explicit null clear one — which is why the nullable fields are resolved
    // to undefined-or-null above rather than passed through raw.
    await tx`
      UPDATE venue SET
        timezone = COALESCE(${input.timezone ?? null}, timezone),
        currency = COALESCE(${input.currency?.toUpperCase() ?? null}, currency),
        theme = COALESCE(${input.theme ?? null}, theme),
        tagline = ${tagline === undefined ? sql`tagline` : tagline},
        address = ${address === undefined ? sql`address` : address},
        min_notice_minutes = COALESCE(${input.minNoticeMinutes ?? null}, min_notice_minutes),
        max_horizon_days = COALESCE(${input.maxHorizonDays ?? null}, max_horizon_days),
        cancellation_mode = COALESCE(${input.cancellationMode ?? null}, cancellation_mode),
        cancellation_grace_hours =
          COALESCE(${input.cancellationGraceHours ?? null}, cancellation_grace_hours),
        refund_terms = ${refundTerms === undefined ? sql`refund_terms` : refundTerms},
        gcash_name = ${gcashName === undefined ? sql`gcash_name` : gcashName}
      WHERE organization_id = ${scope.organizationId}
    `;
  });

  const venue = await venueSettings(scope.organizationId, scope.role);
  if (!venue) return notFound("We couldn't find that venue.");

  const [space] = await sql<{ name: string }[]>`
    SELECT name FROM space
    WHERE organization_id = ${scope.organizationId} AND is_active
    ORDER BY sort_order, name
    LIMIT 1
  `;

  return ok({
    venue,
    bookingUrl: apexUrl(`/${venue.slug}`),
    spaceName: space?.name ?? null,
  });
}
