import { sql } from "@/db";
import { COVER_MAX_BYTES, maxSizeLabel } from "@/lib/branding";
import { fail, notFound, ok } from "@/lib/mobile/respond";
import { putImageBytes } from "@/lib/storage/r2";
import { spaceDetail } from "@/lib/mobile/venue-json";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; spaceId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

async function owns(organizationId: string, spaceId: string) {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM space WHERE id = ${spaceId}::uuid AND organization_id = ${organizationId}
  `;
  return Boolean(row);
}

/**
 * POST /api/mobile/venues/{slug}/spaces/{id}/image — API-CONTRACT #28.
 *
 * Multipart `image` → `{space: SpaceDetail}`. The photo is optional
 * throughout; without one every surface shows the kind placeholder rather than
 * a grey box, so this failing is never fatal to a space.
 *
 * The key prefix is derived from the membership, never from the request, the
 * same as /api/upload — that is what stops one venue writing into another's
 * folder. The app resizes to ≤1600px before sending, so the cap here is a
 * backstop rather than the thing that shapes the file.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug, spaceId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(spaceId) || !(await owns(scope.organizationId, spaceId))) {
    return notFound("We couldn't find that space.");
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return fail(400, { error: "invalid", message: "No image was uploaded." });
  }
  if (!ALLOWED.has(file.type)) {
    return fail(400, { error: "invalid", message: "Use a PNG, JPEG or WebP image." });
  }
  if (file.size > COVER_MAX_BYTES) {
    // 413, so the app can say "too large" rather than "something went wrong".
    return fail(413, {
      error: "too_large",
      message: `That image is too large (max ${maxSizeLabel(COVER_MAX_BYTES)}).`,
    });
  }

  const url = await putImageBytes(
    Buffer.from(await file.arrayBuffer()),
    file.type,
    `orgs/${scope.organizationId}/spaces`,
  );

  await sql`
    UPDATE space SET image_url = ${url}
    WHERE id = ${spaceId}::uuid AND organization_id = ${scope.organizationId}
  `;

  return ok({ space: await spaceDetail(scope.organizationId, spaceId) });
}

/** DELETE … — back to the kind placeholder. */
export async function DELETE(request: Request, { params }: Params) {
  const { slug, spaceId } = await params;
  const scope = await venueScope(request, slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!UUID.test(spaceId) || !(await owns(scope.organizationId, spaceId))) {
    return notFound("We couldn't find that space.");
  }

  await sql`
    UPDATE space SET image_url = NULL
    WHERE id = ${spaceId}::uuid AND organization_id = ${scope.organizationId}
  `;
  return ok({ space: await spaceDetail(scope.organizationId, spaceId) });
}
