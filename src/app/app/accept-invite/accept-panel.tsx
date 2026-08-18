"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { authClient, useSession } from "@/lib/auth-client";

const FIELD = "h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";

/**
 * Accept an invite. If already signed in, one click. Otherwise a compact
 * sign-in / create-account form (no venue is created — this joins an existing
 * one), then accept. The invite is bound to its email, so that's fixed here.
 */
export function AcceptPanel({
  invitationId,
  orgName,
  email,
}: {
  invitationId: string;
  orgName: string;
  email: string;
}) {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    const { error: e } = await authClient.organization.acceptInvitation({ invitationId });
    if (e) throw new Error(e.message ?? "Couldn't accept the invitation.");
    router.replace("/");
    router.refresh();
  }

  async function acceptOnly() {
    setBusy(true);
    setError(null);
    try {
      await accept();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(event.currentTarget);
    const password = String(fd.get("password") ?? "");
    const name = String(fd.get("name") ?? "").trim();
    try {
      if (mode === "signup") {
        const { error: e } = await authClient.signUp.email({ email, password, name });
        if (e) throw new Error(e.message ?? "Could not create the account.");
      } else {
        const { error: e } = await authClient.signIn.email({ email, password });
        if (e) throw new Error(e.message ?? "Could not sign in.");
      }
      await accept();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (isPending) {
    return <p className="text-[0.9375rem] text-ink-3">Loading…</p>;
  }

  if (session?.user) {
    return (
      <div className="grid gap-4">
        <p className="text-[0.9375rem] text-ink-2">
          Signed in as <span className="font-medium text-ink">{session.user.email}</span>.
        </p>
        <Button size="lg" onClick={acceptOnly} disabled={busy} className="w-full">
          {busy ? "Joining…" : `Accept & join ${orgName}`}
        </Button>
        {error ? <p className="text-[0.875rem] text-clay-ink">{error}</p> : null}
      </div>
    );
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Create account or sign in"
        className="mb-5 inline-flex rounded-pill border border-rule bg-paper-2 p-1"
      >
        {(["signup", "signin"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            className={[
              "rounded-pill px-4 py-1.5 text-[0.875rem] transition-colors duration-[--dur-fast] ease-out",
              mode === value ? "bg-ink text-paper" : "text-ink-2 hover:text-ink",
            ].join(" ")}
          >
            {value === "signup" ? "Create account" : "I have an account"}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="grid gap-4">
        {mode === "signup" ? (
          <label className="grid gap-1.5">
            <span className="text-[0.875rem] text-ink-2">Your name</span>
            <input name="name" required autoComplete="name" className={FIELD} />
          </label>
        ) : null}
        <label className="grid gap-1.5">
          <span className="text-[0.875rem] text-ink-2">Email</span>
          <input value={email} readOnly className={`${FIELD} opacity-70`} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[0.875rem] text-ink-2">
            Password {mode === "signup" ? <span className="text-ink-3">(at least 10 characters)</span> : null}
          </span>
          <input
            name="password"
            type="password"
            required
            minLength={mode === "signup" ? 10 : undefined}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={FIELD}
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.875rem] text-clay-ink">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy}>
          {busy ? "Joining…" : `Join ${orgName}`}
        </Button>
      </form>
    </>
  );
}
