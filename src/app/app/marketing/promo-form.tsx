"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { createPromo, type PromoFormState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create code"}
    </Button>
  );
}

export function PromoForm() {
  const [state, formAction] = useActionState<PromoFormState, FormData>(createPromo, {
    status: "idle",
  });
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "created") formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-xl border border-rule bg-card p-5 shadow-plate"
    >
      <h2 className="font-medium">New promo code</h2>
      <p className="mt-1 text-[0.875rem] text-ink-3">
        Customers type this at checkout to get a discount on their booking.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-[0.875rem] text-ink-2">Code</span>
          <input
            name="code"
            required
            maxLength={40}
            autoCapitalize="characters"
            placeholder="SAVE10"
            className="h-11 rounded-sm border border-rule bg-paper px-3 font-mono text-[0.9375rem] uppercase tracking-wide"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-[0.875rem] text-ink-2">Discount type</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "percent" | "amount")}
            className="h-11 rounded-sm border border-rule bg-paper px-3 text-[0.9375rem]"
          >
            <option value="percent">Percentage off</option>
            <option value="amount">Fixed amount off</option>
          </select>
        </label>

        <label className="grid gap-1.5">
          <span className="text-[0.875rem] text-ink-2">
            {kind === "percent" ? "Percent off (1–100)" : "Pesos off"}
          </span>
          <input
            name="value"
            type="number"
            required
            min={1}
            max={kind === "percent" ? 100 : undefined}
            step={1}
            className="h-11 rounded-sm border border-rule bg-paper px-3 text-[0.9375rem]"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-[0.875rem] text-ink-2">
            Max uses <span className="text-ink-3">(optional)</span>
          </span>
          <input
            name="maxUses"
            type="number"
            min={1}
            step={1}
            placeholder="Unlimited"
            className="h-11 rounded-sm border border-rule bg-paper px-3 text-[0.9375rem]"
          />
        </label>

        <label className="grid gap-1.5 sm:col-span-2">
          <span className="text-[0.875rem] text-ink-2">
            Expires <span className="text-ink-3">(optional)</span>
          </span>
          <input
            name="expiresAt"
            type="date"
            className="h-11 rounded-sm border border-rule bg-paper px-3 text-[0.9375rem] sm:w-52"
          />
        </label>
      </div>

      {state.status === "error" ? (
        <p
          role="alert"
          className="mt-4 rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.875rem] text-clay-ink"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === "created" ? (
        <p
          role="status"
          className="mt-4 rounded-sm border border-accent-line bg-accent-soft px-3 py-2 text-[0.875rem] text-accent-ink"
        >
          {state.code} is live — share it with your customers.
        </p>
      ) : null}

      <div className="mt-5">
        <SubmitButton />
      </div>
    </form>
  );
}
