"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createPlan as createPlanFor,
  grantMembership,
  setPlanActive as setPlanActiveFor,
} from "@/lib/memberships";
import { requireRole } from "@/lib/tenancy";

const MANAGE = ["owner", "admin"] as const;

export type PlanFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; name: string };

export async function createPlan(
  _previous: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  const venue = await requireRole(...MANAGE);
  const result = await createPlanFor(venue.organizationId, Object.fromEntries(formData));
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/memberships");
  return { status: "created", name: result.name };
}

export async function setPlanActive(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  await setPlanActiveFor(venue.organizationId, id.data, formData.get("active") === "true");
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
