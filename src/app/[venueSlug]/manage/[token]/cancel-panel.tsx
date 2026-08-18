"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelBooking } from "../../manage-actions";

/**
 * The Cancel control. A two-step confirm (a mis-tap shouldn't drop a booking),
 * then the server action; on success the page re-renders into the cancelled
 * state via router.refresh().
 */
export function CancelPanel({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("token", token);
    startTransition(async () => {
      const result = await cancelBooking(fd);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.875rem] text-ink-2">Cancel this booking?</span>
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="rounded-pill bg-clay px-4 py-2 text-[0.8125rem] font-medium text-paper hover:opacity-90 disabled:opacity-45"
          >
            {pending ? "Cancelling…" : "Yes, cancel"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="rounded-pill border border-rule px-4 py-2 text-[0.8125rem] text-ink-2 hover:border-rule-strong hover:text-ink"
          >
            Keep it
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-pill border border-rule-strong px-5 py-2 text-[0.8125rem] font-medium text-clay-ink hover:border-clay/50"
        >
          Cancel booking
        </button>
      )}

      {error ? (
        <p className="mt-3 rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.8125rem] text-clay-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
