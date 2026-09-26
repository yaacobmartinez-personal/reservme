"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rotateIcalToken } from "@/lib/ical";
import { createApiKey, revokeApiKey } from "@/lib/api-keys";
import { createWebhook, deleteWebhook, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { requireRole } from "@/lib/tenancy";

const MANAGE = ["owner", "admin"] as const;

/** Rotates the iCal feed token, invalidating any existing subscription URL. */
export async function regenerateIcalToken() {
  const venue = await requireRole(...MANAGE);
  await rotateIcalToken(venue.organizationId);
  revalidatePath("/settings");
}

/* ── Webhooks ──────────────────────────────────────────────────── */

const webhookSchema = z.object({
  url: z.string().trim().url("Enter a valid https URL."),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event."),
});

export type WebhookFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created" };

export async function addWebhook(
  _previous: WebhookFormState,
  formData: FormData,
): Promise<WebhookFormState> {
  const venue = await requireRole(...MANAGE);
  const parsed = webhookSchema.safeParse({
    url: formData.get("url"),
    events: formData.getAll("events"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0].message };

  await createWebhook(venue.organizationId, parsed.data.url, parsed.data.events);
  revalidatePath("/settings");
  return { status: "created" };
}

export async function removeWebhook(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const id = z.string().uuid().parse(formData.get("id"));
  await deleteWebhook(venue.organizationId, id);
  revalidatePath("/settings");
}

/* ── API keys ──────────────────────────────────────────────────── */

export type ApiKeyFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; key: string };

export async function addApiKey(
  _previous: ApiKeyFormState,
  formData: FormData,
): Promise<ApiKeyFormState> {
  const venue = await requireRole(...MANAGE);
  const name = z
    .string()
    .trim()
    .min(1, "Name the key.")
    .max(60)
    .safeParse(formData.get("name"));
  if (!name.success) return { status: "error", message: name.error.issues[0].message };

  const { key } = await createApiKey(venue.organizationId, name.data);
  revalidatePath("/settings");
  return { status: "created", key };
}

export async function revokeKey(formData: FormData) {
  const venue = await requireRole(...MANAGE);
  const id = z.string().uuid().parse(formData.get("id"));
  await revokeApiKey(venue.organizationId, id);
  revalidatePath("/settings");
}
