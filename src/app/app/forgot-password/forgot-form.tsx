"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { appUrl } from "@/lib/env";

const FIELD =
  "h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();

    const { error: resetError } = await authClient.requestPasswordReset({
      email,
      redirectTo: appUrl("/reset-password"),
    });
    setBusy(false);

    // Show the same generic confirmation whether or not the account exists — the
    // only thing that surfaces an error is a transport/throttle failure.
    if (resetError) {
      setError(resetError.message ?? "Something went wrong. Please try again.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="grid gap-4">
        <p className="rounded-sm border border-accent-line bg-accent-soft px-3.5 py-3 text-[0.9375rem] text-accent-ink">
          If an account exists for that email, we&rsquo;ve sent a link to reset your
          password. Check your inbox.
        </p>
        <Link href="/login" className="text-[0.875rem] text-ink-2 hover:text-ink">
          ← Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <p className="text-[0.9375rem] text-ink-2">
        Enter your email and we&rsquo;ll send a link to reset your password.
      </p>
      <label className="grid gap-1.5">
        <span className="text-[0.875rem] text-ink-2">Email</span>
        <input name="email" type="email" required autoComplete="email" className={FIELD} />
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.875rem] text-clay-ink"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy}>
        {busy ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/login" className="text-center text-[0.875rem] text-ink-2 hover:text-ink">
        ← Back to log in
      </Link>
    </form>
  );
}
