"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/db";
import { COVER_MAX_BYTES, isTheme, LOGO_MAX_BYTES } from "@/lib/branding";
import { dropImage, storeImage } from "@/lib/storage/r2";
import { requireRole } from "@/lib/tenancy";

/**
 * Branding is an owner/admin concern. Images arrive as data URLs; storeImage
 * validates them (type + size) and offloads to R2 when configured, else keeps
 * them inline — the client check is UX, this is the gate. A field of "__keep__"
 * leaves the stored image alone (so we don't resend a large payload on every
 * save); "" clears it. When an image is replaced or cleared, the old R2 object
 * is deleted.
 */

export type BrandingResult = { ok: true } | { ok: false; error: string };

const KEEP = "__keep__";

/** Resolve a submitted image field to: keep (undefined) / clear (null) / a new value. */
async function resolveImage(
  raw: string,
  maxBytes: number,
  keyPrefix: string,
): Promise<{ value: string | null | undefined } | { error: string }> {
  if (raw === KEEP) return { value: undefined };
  if (raw === "") return { value: null };
  const stored = await storeImage(raw, keyPrefix, maxBytes);
  if (!stored.ok) return { error: stored.error };
  return { value: stored.url };
}

export async function updateBranding(formData: FormData): Promise<BrandingResult> {
  const venue = await requireRole("owner", "admin");
  const org = venue.organizationId;

  const theme = String(formData.get("theme") ?? "pine");
  if (!isTheme(theme)) return { ok: false, error: "Please choose a theme." };

  const logoResolved = await resolveImage(String(formData.get("logo") ?? KEEP), LOGO_MAX_BYTES, `orgs/${org}/logo`);
  if ("error" in logoResolved) return { ok: false, error: logoResolved.error };
  const coverResolved = await resolveImage(String(formData.get("cover") ?? KEEP), COVER_MAX_BYTES, `orgs/${org}/cover`);
  if ("error" in coverResolved) return { ok: false, error: coverResolved.error };

  const [oldLogoRow] = await sql<{ logo: string | null }[]>`SELECT logo FROM organization WHERE id = ${org}`;
  const [oldCoverRow] = await sql<{ cover_url: string | null }[]>`SELECT cover_url FROM venue WHERE organization_id = ${org}`;

  await sql.begin(async (tx) => {
    if (coverResolved.value === undefined) {
      await tx`UPDATE venue SET theme = ${theme} WHERE organization_id = ${org}`;
    } else {
      await tx`
        UPDATE venue SET theme = ${theme}, cover_url = ${coverResolved.value}
        WHERE organization_id = ${org}
      `;
    }
    if (logoResolved.value !== undefined) {
      await tx`UPDATE organization SET logo = ${logoResolved.value} WHERE id = ${org}`;
    }
  });

  // Reap replaced/cleared images from R2 (no-op for inline data URLs).
  if (coverResolved.value !== undefined && oldCoverRow?.cover_url !== coverResolved.value) {
    await dropImage(oldCoverRow?.cover_url);
  }
  if (logoResolved.value !== undefined && oldLogoRow?.logo !== logoResolved.value) {
    await dropImage(oldLogoRow?.logo);
  }

  revalidatePath("/settings");
  revalidatePath(`/${venue.slug}`);
  return { ok: true };
}
