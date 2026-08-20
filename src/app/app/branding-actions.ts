"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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

/**
 * Request-boundary validation. The theme must be a known theme; the image
 * fields are opaque strings here (a data URL, an existing R2 URL, "" to clear,
 * or the KEEP sentinel) — storeImage does the mime + size gate on any new one.
 */
const brandingForm = z.object({
  theme: z.string().refine(isTheme, "unknown theme").default("pine"),
  logo: z.string().default(KEEP),
  cover: z.string().default(KEEP),
});

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

  const parsed = brandingForm.safeParse({
    theme: formData.get("theme") ?? undefined,
    logo: formData.get("logo") ?? undefined,
    cover: formData.get("cover") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Please choose a valid theme." };
  const { theme, logo, cover } = parsed.data;

  const logoResolved = await resolveImage(logo, LOGO_MAX_BYTES, `orgs/${org}/logo`);
  if ("error" in logoResolved) return { ok: false, error: logoResolved.error };
  const coverResolved = await resolveImage(cover, COVER_MAX_BYTES, `orgs/${org}/cover`);
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
