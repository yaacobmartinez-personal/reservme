"use client";

import { useState, useTransition } from "react";
import { joinWaitlistAction } from "./waitlist-actions";

type TakenSlot = { time: string; startsAtISO: string; endsAtISO: string };

/**
 * "Join the waitlist" for a taken slot on the public booking page. If the slot
 * frees (a cancellation), the earliest waiter is emailed a booking link.
 */
export function WaitlistJoin({
  venueSlug,
  spaceId,
  takenSlots,
}: {
  venueSlug: string;
  spaceId: string;
  takenSlots: TakenSlot[];
}) {
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<TakenSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (takenSlots.length === 0) return null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!slot) {
      setError("Pick a time first.");
      return;
    }
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("venueSlug", venueSlug);
    fd.set("spaceId", spaceId);
    fd.set("startsAt", slot.startsAtISO);
    fd.set("endsAt", slot.endsAtISO);
    startTransition(async () => {
      const result = await joinWaitlistAction(fd);
      if (!result.ok) setError(result.error);
      else setDone(result.already ? "You're already on the list for that time." : "You're on the list — we'll email you if it frees.");
    });
  }

  if (done) {
    return (
      <section className="mt-6 rounded-lg border border-accent-line bg-accent-soft p-4 text-[0.9375rem] text-accent-ink">
        {done}
      </section>
    );
  }

  if (!open) {
    return (
      <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-paper-2 p-4">
        <p className="text-[0.9375rem] text-ink-2">A time you wanted is taken?</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-pill border border-rule-strong px-4 py-1.5 text-[0.8125rem] font-medium text-ink-2 hover:border-ink hover:text-ink"
        >
          Join the waitlist
        </button>
      </section>
    );
  }

  const field = "h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";

  return (
    <section className="mt-6 rounded-lg border border-rule bg-card p-5 shadow-plate">
      <h2 className="text-[0.9375rem] font-semibold">Join the waitlist</h2>
      <p className="mt-1 text-[0.8125rem] text-ink-3">Pick a taken time — we&rsquo;ll email you if it frees.</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {takenSlots.map((s) => {
          const active = slot?.startsAtISO === s.startsAtISO;
          return (
            <button
              key={s.startsAtISO}
              type="button"
              onClick={() => setSlot(s)}
              className={[
                "rounded-sm px-3 py-1.5 text-[0.8125rem]",
                active ? "bg-ink text-paper" : "bg-paper-3 text-ink-2 hover:text-ink",
              ].join(" ")}
            >
              {s.time}
            </button>
          );
        })}
      </div>

      <form onSubmit={submit} className="mt-4 grid gap-3">
        <input name="name" required placeholder="Your name" className={field} />
        <input name="email" type="email" required placeholder="you@email.com" className={field} />
        {error ? (
          <p className="rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.8125rem] text-clay-ink">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-pill bg-accent px-5 py-2 text-[0.8125rem] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
          >
            {pending ? "Joining…" : "Join waitlist"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-pill border border-rule px-4 py-2 text-[0.8125rem] text-ink-2 hover:border-rule-strong hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
