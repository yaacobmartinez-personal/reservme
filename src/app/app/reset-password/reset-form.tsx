"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const FIELD =
  "h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";

export function ResetForm() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <div className="grid gap-4">
        <p className="rounded-sm border border-clay/40 bg-clay-soft px-3.5 py-3 text-[0.9375rem] text-clay-ink">
          This reset link is missing or malformed. Request a new one.
        </p>
        <Link href="/forgot-password" className="text-[0.875rem] text-ink-2 hover:text-ink">
          Request a new link
        </Link>
      </div>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const password = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");

    if (password.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don’t match.");
      return;
    }

    setBusy(true);
    setError(null);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token: token as string,
    });
    setBusy(false);

    if (resetError) {
      setError(
        resetError.message ??
          "This reset link is no longer valid — request a new one.",
      );
      return;
    }
    router.replace("/login?reset=1");
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-[0.875rem] text-ink-2">
          New password <span className="text-ink-3">(at least 10 characters)</span>
        </span>
        <input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={FIELD}
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-[0.875rem] text-ink-2">Confirm password</span>
        <input
          name="confirm"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
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
        {busy ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
