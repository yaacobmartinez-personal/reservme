"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const FIELD =
  "h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";

export function AdminLoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const data = new FormData(event.currentTarget);

    const { error: signInError } = await authClient.signIn.email({
      email: String(data.get("email") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    });

    setBusy(false);

    // One message for every failure. Distinguishing "wrong password" from
    // "not a platform admin" would confirm to an attacker that an account
    // exists and is privileged.
    if (signInError) {
      setError("Those credentials didn't work.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-[0.875rem] text-ink-2">Email</span>
        <input name="email" type="email" required autoComplete="email" className={FIELD} />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[0.875rem] text-ink-2">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={FIELD}
        />
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
        {busy ? "Checking…" : "Sign in"}
      </Button>
    </form>
  );
}
