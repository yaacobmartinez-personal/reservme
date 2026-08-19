"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  addApiKey,
  addWebhook,
  regenerateIcalToken,
  removeWebhook,
  revokeKey,
  type ApiKeyFormState,
  type WebhookFormState,
} from "@/app/app/integrations-actions";

// Local copy so this client file doesn't import the server webhooks module.
const EVENTS = ["booking.created", "booking.cancelled"] as const;

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked — the field is selectable anyway */
        }
      }}
      className="whitespace-nowrap rounded-pill border border-rule-strong px-3 py-1.5 text-[0.8125rem] hover:border-ink"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Pending({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

type WebhookView = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
};
type ApiKeyView = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export function IntegrationsSection({
  icalUrl,
  webhooks,
  apiKeys,
}: {
  icalUrl: string;
  webhooks: WebhookView[];
  apiKeys: ApiKeyView[];
}) {
  const [hook, hookAction] = useActionState<WebhookFormState, FormData>(addWebhook, {
    status: "idle",
  });
  const [key, keyAction] = useActionState<ApiKeyFormState, FormData>(addApiKey, {
    status: "idle",
  });

  const fieldCls = "h-11 rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";

  return (
    <section className="mt-6 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
      <h2 className="text-xl">Integrations &amp; API</h2>
      <p className="mt-1 text-[0.875rem] text-ink-3">
        Connect ReservMe to your calendar and other tools.
      </p>

      {/* ── Calendar feed ── */}
      <div className="mt-6 border-t border-rule pt-6">
        <h3 className="font-medium">Calendar feed</h3>
        <p className="mt-1 text-[0.875rem] text-ink-3">
          A private link to subscribe to your bookings in Google or Apple Calendar.
          Keep it secret — anyone with it can see your schedule.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={icalUrl}
            onFocus={(e) => e.currentTarget.select()}
            className={`${fieldCls} min-w-0 flex-1 font-mono text-[0.8125rem]`}
          />
          <CopyButton value={icalUrl} />
          <form action={regenerateIcalToken}>
            <button
              type="submit"
              className="whitespace-nowrap rounded-pill px-3 py-1.5 text-[0.8125rem] text-ink-3 hover:bg-paper-3 hover:text-ink"
            >
              Regenerate
            </button>
          </form>
        </div>
      </div>

      {/* ── Webhooks ── */}
      <div className="mt-8 border-t border-rule pt-6">
        <h3 className="font-medium">Webhooks</h3>
        <p className="mt-1 text-[0.875rem] text-ink-3">
          We POST a signed JSON payload to your URL when a booking is created or
          cancelled. Verify the <code className="font-mono">X-ReservMe-Signature</code>{" "}
          header (HMAC-SHA256 of the body) with the secret.
        </p>

        {webhooks.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {webhooks.map((w) => (
              <li
                key={w.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-rule bg-paper-2 p-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[0.8125rem]">{w.url}</span>
                  <span className="block text-[0.75rem] text-ink-3">
                    {w.events.join(", ")} · secret{" "}
                    <span className="font-mono">{w.secret.slice(0, 12)}…</span>
                  </span>
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <CopyButton value={w.secret} />
                  <form action={removeWebhook}>
                    <input type="hidden" name="id" value={w.id} />
                    <button
                      type="submit"
                      className="text-[0.8125rem] text-ink-3 hover:text-clay-ink"
                    >
                      Delete
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <form action={hookAction} className="mt-4 grid gap-3">
          <input
            name="url"
            type="url"
            required
            placeholder="https://hooks.example.com/reservme"
            className={fieldCls}
          />
          <div className="flex flex-wrap gap-3">
            {EVENTS.map((e) => (
              <label
                key={e}
                className="flex items-center gap-2 rounded-pill border border-rule px-3 py-1.5 text-[0.8125rem]"
              >
                <input
                  type="checkbox"
                  name="events"
                  value={e}
                  defaultChecked
                  className="size-3.5 accent-[var(--color-accent)]"
                />
                {e}
              </label>
            ))}
          </div>
          {hook.status === "error" ? (
            <p className="text-[0.8125rem] text-clay-ink">{hook.message}</p>
          ) : null}
          {hook.status === "created" ? (
            <p className="text-[0.8125rem] text-accent-ink">Webhook added.</p>
          ) : null}
          <div>
            <Pending label="Add webhook" busy="Adding…" />
          </div>
        </form>
      </div>

      {/* ── API keys ── */}
      <div className="mt-8 border-t border-rule pt-6">
        <h3 className="font-medium">API keys</h3>
        <p className="mt-1 text-[0.875rem] text-ink-3">
          Read your spaces and bookings via{" "}
          <code className="font-mono">GET /api/v1/…</code> with{" "}
          <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
        </p>

        {key.status === "created" ? (
          <div className="mt-3 rounded-sm border border-accent-line bg-accent-soft p-3">
            <p className="text-[0.8125rem] text-accent-ink">
              Copy your key now — it won&rsquo;t be shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={key.key}
                onFocus={(e) => e.currentTarget.select()}
                className={`${fieldCls} min-w-0 flex-1 font-mono text-[0.8125rem]`}
              />
              <CopyButton value={key.key} />
            </div>
          </div>
        ) : null}

        {apiKeys.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {apiKeys.map((k) => (
              <li
                key={k.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-rule bg-paper-2 p-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{k.name}</span>
                  <span className="block text-[0.75rem] text-ink-3">
                    <span className="font-mono">{k.keyPrefix}…</span>
                    {k.lastUsedAt ? ` · last used ${k.lastUsedAt}` : " · never used"}
                    {k.revokedAt ? " · revoked" : ""}
                  </span>
                </span>
                {k.revokedAt ? null : (
                  <form action={revokeKey} className="ml-auto">
                    <input type="hidden" name="id" value={k.id} />
                    <button
                      type="submit"
                      className="text-[0.8125rem] text-ink-3 hover:text-clay-ink"
                    >
                      Revoke
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        <form action={keyAction} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="grid flex-1 gap-1.5 text-[0.875rem] text-ink-2">
            <span>New key name</span>
            <input name="name" required maxLength={60} placeholder="Zapier" className={fieldCls} />
          </label>
          <Pending label="Create key" busy="Creating…" />
        </form>
        {key.status === "error" ? (
          <p className="mt-2 text-[0.8125rem] text-clay-ink">{key.message}</p>
        ) : null}
      </div>
    </section>
  );
}
