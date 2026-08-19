"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { emailTenant, type EmailTenantState } from "../../actions";

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 justify-self-start rounded-pill bg-ink px-4 text-[0.875rem] font-medium text-paper transition-opacity duration-[--dur-fast] ease-out hover:opacity-90 disabled:opacity-45"
    >
      {pending ? "Sending…" : "Send email"}
    </button>
  );
}

export function EmailTenantForm({ organizationId }: { organizationId: string }) {
  const [state, formAction] = useActionState<EmailTenantState, FormData>(emailTenant, {
    status: "idle",
  });

  return (
    <form action={formAction} className="mt-3 grid gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input
        name="subject"
        required
        placeholder="Subject"
        className="h-10 rounded-sm border border-rule bg-card px-3 text-[0.9375rem]"
      />
      <textarea
        name="body"
        required
        rows={4}
        placeholder="Message to the venue owner…"
        className="rounded-sm border border-rule bg-card px-3 py-2 text-[0.9375rem]"
      />
      {state.status === "error" ? (
        <p className="text-[0.8125rem] text-clay-ink">{state.message}</p>
      ) : null}
      {state.status === "sent" ? (
        <p className="text-[0.8125rem] text-accent-ink">Email sent to the owner.</p>
      ) : null}
      <SendButton />
    </form>
  );
}
