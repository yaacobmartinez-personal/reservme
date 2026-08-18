"use client";

import Link from "next/link";
import { useState } from "react";

type Kind = "trial" | "due" | "review";

const TONE: Record<Kind, string> = {
  trial: "border-rule bg-paper-2 text-ink-2",
  due: "border-clay/40 bg-clay-soft text-clay-ink",
  review: "border-accent-line bg-accent-soft text-accent-ink",
};

/**
 * Billing nudge in the app shell. The "due" and "review" states are important
 * enough to stay put; only the gentle trial-ending reminder is dismissible.
 */
export function BillingBanner({ kind, message }: { kind: Kind; message: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className={`border-b ${TONE[kind]}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5 sm:px-8">
        <span className="text-[0.8125rem]">{message}</span>
        <div className="ml-auto flex items-center gap-3">
          {kind === "review" ? null : (
            <Link href="/billing" className="text-[0.8125rem] font-medium underline underline-offset-2">
              {kind === "due" ? "Pay now" : "Set up payment"}
            </Link>
          )}
          {kind === "trial" ? (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
              className="text-ink-3 hover:text-ink"
            >
              <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
