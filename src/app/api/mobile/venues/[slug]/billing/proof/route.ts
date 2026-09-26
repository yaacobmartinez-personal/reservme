import { billingJson, proofProblem, submitProof } from "@/lib/mobile/billing-json";
import { COVER_MAX_BYTES, maxSizeLabel } from "@/lib/branding";
import { conflict, fail, invalid, ok } from "@/lib/mobile/respond";
import { putImageBytes } from "@/lib/storage/r2";
import { isFailure, MANAGE, venueScope } from "@/lib/mobile/venue-scope";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * POST /api/mobile/venues/{slug}/billing/proof — API-CONTRACT #32.
 *
 * Multipart, with or without a screenshot, so the server has one shape to
 * parse. The **amount is never in the request**: it is derived from the band,
 * so the form cannot declare what it owes.
 *
 * A quoted plan and an already-pending payment are both 409s rather than
 * validation errors — neither is something the owner typed wrong, and the app
 * shows them as an explanation instead of a red field.
 */
export async function POST(request: Request, { params }: Params) {
  const scope = await venueScope(request, (await params).slug, MANAGE);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });

  const form = await request.formData().catch(() => null);
  if (!form) return invalid({ reference: "Enter the InstaPay reference number." });

  const reference = form.get("reference");
  const paidAt = form.get("paidAt");
  const problem = proofProblem(reference, paidAt);
  if (problem) {
    return invalid(
      { [problem.startsWith("Pick the date") ? "paidAt" : "reference"]: problem },
      problem,
    );
  }

  // The screenshot is read *before* the row is written, so a rejected image
  // does not leave a payment behind that the owner cannot attach proof to.
  let receiptUrl: string | null = null;
  const file = form.get("image");
  if (file instanceof File && file.size > 0) {
    if (!ALLOWED.has(file.type)) {
      return fail(400, { error: "invalid", message: "Use a PNG, JPEG or WebP image." });
    }
    if (file.size > COVER_MAX_BYTES) {
      return fail(413, {
        error: "too_large",
        message: `That image is too large (max ${maxSizeLabel(COVER_MAX_BYTES)}).`,
      });
    }
    receiptUrl = await putImageBytes(
      Buffer.from(await file.arrayBuffer()),
      file.type,
      `venues/${scope.organizationId}/receipts`,
    );
  }

  const refusal = await submitProof(
    scope.organizationId,
    String(reference),
    String(paidAt),
  );
  if (refusal) return conflict(refusal.reason, refusal.message);

  if (receiptUrl) {
    // The insert above is the web's, unchanged; the receipt is attached to the
    // row it just wrote — the only submitted payment this venue can have.
    await sql`
      UPDATE billing_payment SET receipt_url = ${receiptUrl}
      WHERE organization_id = ${scope.organizationId} AND status = 'submitted'
    `;
  }

  return ok({ billing: await billingJson(scope.organizationId) }, 201);
}
