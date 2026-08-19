"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { createPlan, type PlanFormState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create plan"}
    </Button>
  );
}

const FIELD = "h-11 rounded-sm border border-rule bg-paper px-3 text-[0.9375rem]";
const LABEL = "grid gap-1.5 text-[0.875rem] text-ink-2";

export function PlanForm() {
  const [state, formAction] = useActionState<PlanFormState, FormData>(createPlan, {
    status: "idle",
  });
  const [kind, setKind] = useState<"pass" | "membership">("pass");
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
      <h2 className="font-medium">New plan</h2>
      <p className="mt-1 text-[0.875rem] text-ink-3">
        A <b>pass</b> is a one-time pack of booking credits. A <b>membership</b> is a
        recurring plan that can carry credits and/or a discount.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={LABEL}>
          <span>Name</span>
          <input name="name" required maxLength={60} placeholder="10-session pack" className={FIELD} />
        </label>
        <label className={LABEL}>
          <span>Type</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "pass" | "membership")}
            className={FIELD}
          >
            <option value="pass">Pass · one-time</option>
            <option value="membership">Membership · monthly</option>
          </select>
        </label>

        <label className={LABEL}>
          <span>Price (₱)</span>
          <input name="price" inputMode="decimal" required placeholder="4000" className={FIELD} />
        </label>
        <label className={LABEL}>
          <span>
            Booking credits <span className="text-ink-3">({kind === "pass" ? "pack size" : "per month, optional"})</span>
          </span>
          <input name="credits" type="number" min={1} step={1} placeholder="10" className={FIELD} />
        </label>

        <label className={LABEL}>
          <span>
            Discount on bookings <span className="text-ink-3">(% off, optional)</span>
          </span>
          <input name="discountPct" type="number" min={1} max={100} step={1} placeholder="—" className={FIELD} />
        </label>
        <label className={LABEL}>
          <span>
            Valid for <span className="text-ink-3">(days, optional)</span>
          </span>
          <input name="validDays" type="number" min={1} step={1} placeholder="No expiry" className={FIELD} />
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
          {state.name} created — grant it to customers from their profile.
        </p>
      ) : null}

      <div className="mt-5">
        <SubmitButton />
      </div>
    </form>
  );
}
