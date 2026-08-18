"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { appUrl } from "@/lib/env";

/**
 * Soft nudge for an unverified owner. Never blocks use (the sign-up flow needs
 * the session it gets back to create the venue); it just asks them to confirm
 * their email and offers a one-click resend. Dismissible for the session.
 */
export function VerifyBanner({ email }: { email: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  if (dismissed) return null;

  async function resend() {
    setState("sending");
    await authClient.sendVerificationEmail({
      email,
      callbackURL: appUrl("/verify-email"),
    });
    setState("sent");
  }

  return (
    <div className="border-b border-clay/30 bg-clay-soft">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5 sm:px-8">
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4 shrink-0 text-clay-ink">
          <rect x="2.5" y="4.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 6l7 5 7-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[0.8125rem] text-clay-ink">
          Confirm your email to secure your account. We sent a link to{" "}
          <span className="font-medium">{email}</span>.
        </span>
        <div className="ml-auto flex items-center gap-2">
          {state === "sent" ? (
            <span className="text-[0.8125rem] font-medium text-clay-ink">Sent ✓</span>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={state === "sending"}
              className="rounded-pill bg-ink px-3 py-1 text-[0.8125rem] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-45"
            >
              {state === "sending" ? "Sending…" : "Resend"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="text-clay-ink/70 hover:text-clay-ink"
          >
            <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
