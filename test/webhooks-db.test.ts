/**
 * The webhook endpoint store: create / list / select-by-event / delete, plus
 * the active + subscription filtering that decides who gets a delivery.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWebhook,
  deleteWebhook,
  enqueueWebhookEvent,
  listWebhooks,
  selectWebhookTargets,
} from "@/lib/webhooks";

const ORG = "org_webhooks_db_test";
const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });

beforeAll(async () => {
  await sql`DELETE FROM organization WHERE id = ${ORG}`;
  await sql`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Webhooks Test', 'webhooks-test')`;
});

afterAll(async () => {
  await sql`DELETE FROM organization WHERE id = ${ORG}`;
});

describe("webhook endpoints", () => {
  it("creates with a signing secret, lists, selects by event, and deletes", async () => {
    const { id, secret } = await createWebhook(ORG, "https://hooks.example/created", [
      "booking.created",
    ]);
    expect(secret).toMatch(/^whsec_/);

    const list = await listWebhooks(ORG);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("https://hooks.example/created");
    expect(list[0].events).toContain("booking.created");
    expect(list[0].active).toBe(true);

    // Subscribed event → the endpoint is a target; other event → not.
    const targets = await selectWebhookTargets(ORG, "booking.created");
    expect(targets).toHaveLength(1);
    expect(targets[0].secret).toBe(secret);
    expect(await selectWebhookTargets(ORG, "booking.cancelled")).toHaveLength(0);

    await deleteWebhook(ORG, id);
    expect(await listWebhooks(ORG)).toHaveLength(0);
  });

  it("excludes inactive endpoints from the delivery targets", async () => {
    const { id } = await createWebhook(ORG, "https://hooks.example/inactive", [
      "booking.created",
    ]);
    await sql`UPDATE webhook_endpoint SET active = false WHERE id = ${id}::uuid`;
    expect(await selectWebhookTargets(ORG, "booking.created")).toHaveLength(0);
    await deleteWebhook(ORG, id);
  });

  it("enqueueWebhookEvent is a no-op when nothing is subscribed", async () => {
    // No active endpoint for this event → returns without touching the queue.
    await expect(
      enqueueWebhookEvent(ORG, "booking.cancelled", { reservationId: "x" }),
    ).resolves.toBeUndefined();
  });
});
