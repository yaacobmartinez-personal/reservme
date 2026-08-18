"use client";

import { useRef, useState, useTransition } from "react";
import { submitBillingPayment } from "@/app/app/billing-actions";

const FIELD = "h-10 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.875rem]";

export function PaymentForm({ today }: { today: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        e.preventDefault();
        const form = ref.current;
        if (!form) return;
        setError(null);
        const fd = new FormData(form);
        startTransition(async () => {
          const result = await submitBillingPayment(fd);
          if (!result.ok) setError(result.error);
        });
      }}
      className="grid gap-3"
    >
      <label className="grid gap-1 text-[0.8125rem] text-ink-2">
        <span>InstaPay reference number</span>
        <input name="reference" required placeholder="e.g. 4021 8837 2210" className={FIELD} />
      </label>
      <label className="grid gap-1 text-[0.8125rem] text-ink-2">
        <span>Date paid</span>
        <input type="date" name="paidAt" required defaultValue={today} max={today} className={`${FIELD} sm:w-44`} />
      </label>

      {error ? (
        <p className="rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.8125rem] text-clay-ink">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-pill bg-accent px-5 py-2 text-[0.8125rem] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
        >
          {pending ? "Submitting…" : "Submit payment"}
        </button>
      </div>
    </form>
  );
}
