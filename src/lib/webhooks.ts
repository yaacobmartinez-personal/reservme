import crypto from "node:crypto";
import { sql } from "@/db";
import { getBoss, QUEUES } from "@/lib/jobs/boss";

/**
 * Outbound webhooks. Owners register endpoints for booking events; on each event
 * we fan out a signed delivery job (pg-boss owns retries). The signature is an
 * HMAC-SHA256 of the exact body with the endpoint secret, so the receiver can
 * verify authenticity.
 */

export const WEBHOOK_EVENTS = ["booking.created", "booking.cancelled"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type WebhookRow = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: Date;
};

export async function listWebhooks(organizationId: string): Promise<WebhookRow[]> {
  const rows = await sql<
    { id: string; url: string; secret: string; events: string[]; active: boolean; created_at: Date }[]
  >`
    SELECT id, url, secret, events, active, created_at
    FROM webhook_endpoint
    WHERE organization_id = ${organizationId}
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    secret: r.secret,
    events: r.events,
    active: r.active,
    createdAt: r.created_at,
  }));
}

export async function createWebhook(
  organizationId: string,
  url: string,
  events: WebhookEvent[],
): Promise<{ id: string; secret: string }> {
  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO webhook_endpoint (organization_id, url, secret, events)
    VALUES (${organizationId}, ${url}, ${secret}, ${events})
    RETURNING id
  `;
  return { id: row.id, secret };
}

export async function deleteWebhook(organizationId: string, id: string): Promise<void> {
  await sql`
    DELETE FROM webhook_endpoint
    WHERE id = ${id}::uuid AND organization_id = ${organizationId}
  `;
}

export function signPayload(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Active endpoints in this org subscribed to the given event. */
export async function selectWebhookTargets(
  organizationId: string,
  event: WebhookEvent,
): Promise<{ url: string; secret: string }[]> {
  return sql<{ url: string; secret: string }[]>`
    SELECT url, secret FROM webhook_endpoint
    WHERE organization_id = ${organizationId} AND active AND ${event} = ANY(events)
  `;
}

/** Fans out a signed delivery job to every active endpoint for this event. */
export async function enqueueWebhookEvent(
  organizationId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const endpoints = await selectWebhookTargets(organizationId, event);
  if (endpoints.length === 0) return;

  const body = JSON.stringify({ event, data, sentAt: new Date().toISOString() });
  const boss = await getBoss();
  for (const ep of endpoints) {
    await boss.send(QUEUES.webhookDelivery, {
      url: ep.url,
      event,
      body,
      signature: signPayload(ep.secret, body),
    });
  }
}

/**
 * Builds a booking payload from the current DB row and fans it out. Best-effort
 * and self-contained so callers can fire-and-forget after a booking write.
 */
export async function emitBookingEvent(
  organizationId: string,
  event: WebhookEvent,
  reservationId: string,
): Promise<void> {
  const [r] = await sql<
    {
      reference: string;
      space_name: string;
      customer_name: string | null;
      customer_email: string | null;
      starts_at: Date;
      ends_at: Date;
      amount_cents: number;
      status: string;
    }[]
  >`
    SELECT r.reference, s.name AS space_name, c.name AS customer_name, c.email AS customer_email,
           r.starts_at, r.ends_at, r.amount_cents, r.status
    FROM reservation r
    JOIN space s ON s.id = r.space_id
    LEFT JOIN customer c ON c.id = r.customer_id
    WHERE r.id = ${reservationId}::uuid AND r.organization_id = ${organizationId}
  `;
  if (!r) return;

  await enqueueWebhookEvent(organizationId, event, {
    reference: r.reference,
    space: r.space_name,
    customer: r.customer_name,
    customerEmail: r.customer_email,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    amountCents: r.amount_cents,
    status: r.status,
  });
}

export type WebhookJob = { url: string; event: string; body: string; signature: string };

/** Delivers one job; throws on a non-2xx so pg-boss retries. */
export async function deliverWebhook(job: WebhookJob): Promise<void> {
  const res = await fetch(job.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "ReservMe-Webhook/1",
      "x-reservme-event": job.event,
      "x-reservme-signature": job.signature,
    },
    body: job.body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`webhook ${job.url} responded ${res.status}`);
}
