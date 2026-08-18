"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/db";
import { COVER_MAX_BYTES, isTheme, LOGO_MAX_BYTES, validateImageDataUrl } from "@/lib/branding";
import { requireRole } from "@/lib/tenancy";

/**
 * Branding is an owner/admin concern. Images arrive as data URLs and are
 * re-validated here (type + size) before anything is written — the client check
 * is UX, this is the gate. A field of "__keep__" leaves the stored image alone
 * (so we don't resend a large data URL on every save); "" clears it.
 */

export type BrandingResult = { ok: true } | { ok: false; error: string };

const KEEP = "__keep__";

/** Resolve a submitted image field to: keep (undefined) / clear (null) / a new value. */
function resolveImage(
  raw: string,
  maxBytes: number,
): { value: string | null | undefined } | { error: string } {
  if (raw === KEEP) return { value: undefined };
  if (raw === "") return { value: null };
  const check = validateImageDataUrl(raw, maxBytes);
  if (!check.ok) return { error: check.error };
  return { value: raw };
}

export async function updateBranding(formData: FormData): Promise<BrandingResult> {
  const venue = await requireRole("owner", "admin");

  const theme = String(formData.get("theme") ?? "pine");
  if (!isTheme(theme)) return { ok: false, error: "Please choose a theme." };

  const logoResolved = resolveImage(String(formData.get("logo") ?? KEEP), LOGO_MAX_BYTES);
  if ("error" in logoResolved) return { ok: false, error: logoResolved.error };
  const coverResolved = resolveImage(String(formData.get("cover") ?? KEEP), COVER_MAX_BYTES);
  if ("error" in coverResolved) return { ok: false, error: coverResolved.error };

  await sql.begin(async (tx) => {
    if (coverResolved.value === undefined) {
      await tx`UPDATE venue SET theme = ${theme} WHERE organization_id = ${venue.organizationId}`;
    } else {
      await tx`
        UPDATE venue SET theme = ${theme}, cover_url = ${coverResolved.value}
        WHERE organization_id = ${venue.organizationId}
      `;
    }
    if (logoResolved.value !== undefined) {
      await tx`UPDATE organization SET logo = ${logoResolved.value} WHERE id = ${venue.organizationId}`;
    }
  });

  revalidatePath("/settings");
  revalidatePath(`/${venue.slug}`);
  return { ok: true };
}
