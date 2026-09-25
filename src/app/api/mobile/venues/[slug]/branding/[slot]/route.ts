import { sql } from "@/db";
import { COVER_MAX_BYTES, LOGO_MAX_BYTES, maxSizeLabel } from "@/lib/branding";
import { fail, notFound, ok } from "@/lib/mobile/respond";
import { putImageBytes } from "@/lib/storage/r2";
import { venueSettings } from "@/lib/mobile/venue-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; slot: string }> };

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * The logo lives on `organization.logo` and the cover on `venue.cover_url` —
 * two tables, because the logo is Better Auth's column and predates the cover.
 */
const SLOTS = {
  logo: { dir: "logo", max: LOGO_MAX_BYTES },
  cover: { dir: "cover", max: COVER_MAX_BYTES },
} as const;

type Slot = keyof typeof SLOTS;

async function write(organizationId: string, slot: Slot, url: string | null) {
  if (slot === "logo") {
    await sql`UPDATE organization SET logo = ${url} WHERE id = ${organizationId}`;
  } else {
    await sql`UPDATE venue SET cover_url = ${url} WHERE organization_id = ${organizationId}`;
  }
}

/** POST /api/mobile/venues/{slug}/branding/{logo|cover} — API-CONTRACT #30. */
export async function POST(request: Request, { params }: Params) {
  const { slug, slot: raw } = await params;
  const slot = raw as Slot;
  if (!(slot in SLOTS)) return notFound("Unknown branding slot.");

  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return fail(400, { error: "invalid", message: "No image was uploaded." });
  }
  if (!ALLOWED.has(file.type)) {
    return fail(400, { error: "invalid", message: "Use a PNG, JPEG or WebP image." });
  }
  if (file.size > SLOTS[slot].max) {
    return fail(413, {
      error: "too_large",
      message: `That image is too large (max ${maxSizeLabel(SLOTS[slot].max)}).`,
    });
  }

  // The key prefix comes from the membership, never the request — that is what
  // stops one venue writing into another's folder.
  const url = await putImageBytes(
    Buffer.from(await file.arrayBuffer()),
    file.type,
    `orgs/${scope.organizationId}/${SLOTS[slot].dir}`,
  );
  await write(scope.organizationId, slot, url);

  const venue = await venueSettings(scope.organizationId, scope.role);
  return venue ? ok({ venue }) : notFound("We couldn't find that venue.");
}

/** DELETE … — clears the slot; the booking page falls back to its wordmark. */
export async function DELETE(request: Request, { params }: Params) {
  const { slug, slot: raw } = await params;
  const slot = raw as Slot;
  if (!(slot in SLOTS)) return notFound("Unknown branding slot.");

  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  await write(scope.organizationId, slot, null);

  const venue = await venueSettings(scope.organizationId, scope.role);
  return venue ? ok({ venue }) : notFound("We couldn't find that venue.");
}
