"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reviewUrlProblem, setReviewUrl } from "@/lib/engagement";
import { createPromo as createPromoFor, setPromoActive as setPromoActiveFor } from "@/lib/promo";
import { requireRole } from "@/lib/tenancy";

export type PromoFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; code: string };

export async function createPromo(
  _previous: PromoFormState,
  formData: FormData,
): Promise<PromoFormState> {
  const venue = await requireRole("owner", "admin");
  const result = await createPromoFor(
    venue.organizationId,
    venue.timezone,
    Object.fromEntries(formData),
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/marketing");
  return { status: "created", code: result.code };
}

export type ReviewFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "saved" };

export async function updateReviewUrl(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const venue = await requireRole("owner", "admin");
  const value = formData.get("reviewUrl");
  const problem = reviewUrlProblem(value);
  if (problem) return { status: "error", message: problem };
  await setReviewUrl(venue.organizationId, typeof value === "string" ? value : null);
  revalidatePath("/marketing");
  return { status: "saved" };
}

export async function setPromoActive(formData: FormData) {
  const venue = await requireRole("owner", "admin");
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  await setPromoActiveFor(venue.organizationId, id.data, formData.get("active") === "true");
  revalidatePath("/marketing");
}
