"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import type { Slot } from "@/lib/booking/availability";
import { bookSlot, type BookingState } from "./actions";

const SLOT_STATE: Record<string, string> = {
  open: "border-rule bg-card text-ink hover:border-ink hover:-translate-y-px",
  taken: "border-transparent bg-paper-3 text-ink-3 line-through cursor-not-allowed",
  closed: "border-transparent bg-paper-3 text-ink-3 cursor-not-allowed",
  too_soon: "border-transparent bg-paper-3 text-ink-3 cursor-not-allowed",
  too_far_ahead: "border-transparent bg-paper-3 text-ink-3 cursor-not-allowed",
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Reserving your slot…" : label}
    </Button>
  );
}

export function BookingForm({
  venueSlug,
  spaceId,
  slots,
  currency,
}: {
  venueSlug: string;
  spaceId: string;
  slots: Slot[];
  currency: string;
}) {
  const [state, formAction] = useActionState<BookingState, FormData>(bookSlot, {
    status: "idle",
  });
  const [selected, setSelected] = useState<Slot | null>(null);

  if (state.status === "booked") {
    return (
      <div className="rounded-lg border border-accent-line bg-accent-soft p-6 text-center">
        <p className="label text-accent-ink">Confirmed</p>
        <p className="mt-3 font-display text-2xl text-accent-ink">{state.label}</p>
        <p className="mt-2 text-[0.9375rem] text-accent-ink/80">
          Reference{" "}
          <span className="font-mono font-medium">{state.reference}</span> — keep it
          for your visit.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="venueSlug" value={venueSlug} />
      <input type="hidden" name="spaceId" value={spaceId} />
      <input
        type="hidden"
        name="startsAt"
        value={selected?.startsAt.toISOString() ?? ""}
      />
      <input type="hidden" name="endsAt" value={selected?.endsAt.toISOString() ?? ""} />

      <fieldset>
        <legend className="label text-ink-3">Pick a time</legend>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {slots.length === 0 ? (
            <p className="col-span-full text-[0.9375rem] text-ink-3">
              Nothing bookable on this day.
            </p>
          ) : null}

          {slots.map((slot) => {
            const key = slot.startsAt.toISOString();
            const isSelected = selected?.startsAt.getTime() === slot.startsAt.getTime();
            return (
              <button
                key={key}
                type="button"
                disabled={!slot.available}
                aria-pressed={isSelected}
                onClick={() => setSelected(slot)}
                className={[
                  "flex h-11 items-center justify-center rounded-sm border font-mono text-[0.8125rem]",
                  "transition-[background-color,border-color,transform,color] duration-[--dur-fast] ease-out",
                  "motion-reduce:transform-none",
                  isSelected
                    ? "border-accent bg-accent text-on-accent shadow-plate"
                    : SLOT_STATE[slot.reason],
                ].join(" ")}
              >
                {slot.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {selected ? (
        <div className="mt-6 border-t border-rule pt-6">
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-[0.9375rem] font-medium">{selected.label}</span>
            <span className="font-display text-2xl">
              {formatMoney(selected.priceCents, currency)}
            </span>
          </p>

          <div className="mt-5 grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-[0.875rem] text-ink-2">Name</span>
              <input
                name="name"
                required
                autoComplete="name"
                className="h-11 rounded-sm border border-rule bg-card px-3 text-[0.9375rem]"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[0.875rem] text-ink-2">Email</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="h-11 rounded-sm border border-rule bg-card px-3 text-[0.9375rem]"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[0.875rem] text-ink-2">
                Mobile <span className="text-ink-3">(optional)</span>
              </span>
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                className="h-11 rounded-sm border border-rule bg-card px-3 text-[0.9375rem]"
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

          <div className="mt-5">
            <SubmitButton label={`Reserve ${selected.label}`} />
          </div>

          <p className="mt-3 text-center text-[0.8125rem] text-ink-3">
            No account needed — your slot is confirmed instantly.
          </p>
        </div>
      ) : (
        <p className="mt-6 border-t border-rule pt-6 text-[0.9375rem] text-ink-3">
          Choose a time to continue.
        </p>
      )}
    </form>
  );
}
