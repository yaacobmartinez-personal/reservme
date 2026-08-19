"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/db";
import { requireRole } from "@/lib/tenancy";

export type PromoFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; code: string };

const createSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, "A code needs at least 2 characters.")
      .max(40)
      .regex(/^[A-Za-z0-9]+$/, "Use letters and numbers only — no spaces."),
    kind: z.enum(["percent", "amount"]),
    value: z.coerce.number().int().positive("Enter a discount greater than zero."),
    maxUses: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().int().positive().optional(),
    ),
    expiresAt: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().optional(),
    ),
  })
  .refine((d) => d.kind !== "percent" || (d.value >= 1 && d.value <= 100), {
    message: "A percentage discount must be between 1 and 100.",
    path: ["value"],
  });

export async function createPromo(
  _previous: PromoFormState,
  formData: FormData,
): Promise<PromoFormState> {
  const venue = await requireRole("owner", "admin");

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }
  const input = parsed.data;

  const code = input.code.toUpperCase();
  // Percent is stored as-is; a peso amount is stored in centavos.
  const value = input.kind === "amount" ? input.value * 100 : input.value;
  const maxUses = input.maxUses ?? null;

  // Interpret the expiry date as end-of-day in the venue's timezone, so a code
  // set to expire "today" stays valid through the venue's closing hours.
  const expiresAt = input.expiresAt
    ? sql`(${`${input.expiresAt} 23:59:59`})::timestamp AT TIME ZONE ${venue.timezone}`
    : sql`NULL`;

  try {
    await sql`
      INSERT INTO promo_code (organization_id, code, kind, value, max_uses, expires_at)
      VALUES (${venue.organizationId}, ${code}, ${input.kind}, ${value}, ${maxUses}, ${expiresAt})
    `;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { status: "error", message: `You already have a code named ${code}.` };
    }
    throw error;
  }

  revalidatePath("/marketing");
  return { status: "created", code };
}

export type ReviewFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "saved" };

const reviewSchema = z.object({
  reviewUrl: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().url("Enter a full link, e.g. https://g.page/…").nullable(),
  ),
});

export async function updateReviewUrl(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const venue = await requireRole("owner", "admin");

  const parsed = reviewSchema.safeParse({ reviewUrl: formData.get("reviewUrl") });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  await sql`
    UPDATE venue SET review_url = ${parsed.data.reviewUrl}
    WHERE organization_id = ${venue.organizationId}
  `;
  revalidatePath("/marketing");
  return { status: "saved" };
}

export async function setPromoActive(formData: FormData) {
  const venue = await requireRole("owner", "admin");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  if (!id) return;

  await sql`
    UPDATE promo_code SET active = ${active}
    WHERE id = ${id}::uuid AND organization_id = ${venue.organizationId}
  `;
  revalidatePath("/marketing");
}
