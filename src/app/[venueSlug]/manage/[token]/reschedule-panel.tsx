"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RescheduleDay } from "@/lib/booking/manage";
import { rescheduleBooking } from "../../manage-actions";

/**
 * Same-space reschedule: pick another open slot over the next few days. The move
 * goes through the engine with customer (not staff) policy, so notice/horizon
 * apply and an overlap is refused.
 */
export function ReschedulePanel({
  slug,
  token,
  options,
}: {
  slug: string;
  token: string;
  options: RescheduleDay[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const firstWithSlots = options.find((d) => d.slots.length > 0)?.date ?? options[0]?.date ?? "";
  const [date, setDate] = useState(firstWithSlots);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const day = options.find((d) => d.date === date);
  const anySlots = options.some((d) => d.slots.length > 0);

  function confirm() {
    if (!chosen) return;
    setError(null);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("token", token);
    fd.set("startsAt", chosen);
    startTransition(async () => {
      const result = await rescheduleBooking(fd);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-pill border border-rule-strong px-5 py-2 text-[0.8125rem] font-medium text-ink-2 hover:border-ink hover:text-ink"
      >
        Reschedule
      </button>
    );
  }

  if (!anySlots) {
    return (
      <div className="rounded-lg border border-rule bg-paper-2 p-4 text-[0.875rem] text-ink-2">
        No open times in the next week — please contact the venue to reschedule.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-rule bg-card p-4 shadow-plate">
      <p className="text-[0.875rem] font-medium">Pick a new time</p>

      {/* Dates */}
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {options.map((d) => {
          const active = d.date === date;
          const disabled = d.slots.length === 0;
          return (
            <button
              key={d.date}
              type="button"
              disabled={disabled}
              onClick={() => {
                setDate(d.date);
                setChosen(null);
              }}
              className={[
                "flex flex-col items-center gap-0.5 rounded-sm border py-1.5 text-[0.75rem]",
                active
                  ? "border-ink bg-ink text-paper"
                  : disabled
                    ? "border-rule text-ink-3 opacity-40"
                    : "border-rule text-ink-2 hover:border-rule-strong",
              ].join(" ")}
            >
              <span className="opacity-70">{d.weekday}</span>
              <span className="font-mono">{d.dayNum}</span>
            </button>
          );
        })}
      </div>

      {/* Slots */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {day && day.slots.length > 0 ? (
          day.slots.map((s) => {
            const active = chosen === s.startsAtISO;
            return (
              <button
                key={s.startsAtISO}
                type="button"
                onClick={() => setChosen(s.startsAtISO)}
                className={[
                  "rounded-sm px-3 py-1.5 text-[0.8125rem]",
                  active ? "bg-accent text-on-accent" : "bg-accent-soft text-accent-ink hover:bg-accent-line",
                ].join(" ")}
              >
                {s.time}
              </button>
            );
          })
        ) : (
          <p className="text-[0.8125rem] text-ink-3">No open times that day.</p>
        )}
      </div>

      {error ? (
        <p className="mt-3 rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.8125rem] text-clay-ink">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={!chosen || pending}
          className="rounded-pill bg-accent px-4 py-2 text-[0.8125rem] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
        >
          {pending ? "Moving…" : "Confirm new time"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="rounded-pill border border-rule px-4 py-2 text-[0.8125rem] text-ink-2 hover:border-rule-strong hover:text-ink"
        >
          Back
        </button>
      </div>
    </div>
  );
}
