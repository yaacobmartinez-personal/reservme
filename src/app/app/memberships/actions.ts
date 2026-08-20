"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/db";
import { grantMembership } from "@/lib/memberships";
import { requireRole } from "@/lib/tenancy";

const MANAGE = ["owner", "admin"] as const;

export type PlanFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; name: string };

const createSchema = z
  .object({
    name: z.string().trim().min(2, "Give the plan a name.").max(60),
    kind: z.enum(["pass", "membership"]),
    price: z.coerce.number().min(0, "Price can't be negative."),
    credits: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().int().positive().optional(),
    ),
    discountPct: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().int().min(1).max(100).optional(),
    ),
    validDays: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().int().positive().optional(),
    ),
  })
  .refine((d) => d.credits != null || d.discountPct != null, {
    message: "A plan needs either credits or a discount (or both).",
    path: ["credits"],
  });

export async function createPlan(
  _previous: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  const venue = await requireRole(...MANAGE);

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0].message };
  const d = parsed.data;

  const priceCents = Math.round(d.price * 100);
  const period = d.kind === "membership" ? "monthly" : "one_time";

  try {
    await sql`
      INSERT INTO membership_plan
        (organization_id, name, kind, price_cents, credits, period, benefit_discount_pct, valid_days)
      VALUES (
        ${venue.organizationId}, ${d.name}, ${d.kind}, ${priceCents},
        ${d.credits ?? null}, ${period}, ${d.discountPct ?? null}, ${d.validDays ?? null}
      )
    `;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { status: "error", message: `You already have a plan named ${d.name}.` };
    }
    throw error;
  }

  revalidatePath("/memberships");
  return { status: "created", name: d.name };
}

export async function setPlanActive(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const id = z.string().uuid().safeParse(formData.get("id"));
  const active = formData.get("active") === "true";
  if (!id.success) return;

  await sql`
    UPDATE membership_plan SET active = ${active}
    WHERE id = ${id.data}::uuid AND organization_id = ${venue.organizationId}
  `;
  revalidatePath("/memberships");
}

/** Grants a plan to a customer, from the CRM profile. */
export async function grantToCustomer(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const customerId = z.string().uuid().parse(formData.get("customerId"));
  const planId = z.string().uuid().parse(formData.get("planId"));

  await grantMembership(venue.organizationId, customerId, planId);
  revalidatePath(`/customers/${customerId}`);
}
