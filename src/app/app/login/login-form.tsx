"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { RESERVED_SLUGS } from "@/content/legal";
import { authClient } from "@/lib/auth-client";
import { slugify } from "@/lib/slug";

type Mode = "signin" | "signup";

const FIELD =
  "h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";

export function LoginForm({ startOnSignup = false }: { startOnSignup?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(startOnSignup ? "signup" : "signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "").trim();
    const venueName = String(data.get("venueName") ?? "").trim();

    try {
      if (mode === "signin") {
        const { error: signInError } = await authClient.signIn.email({ email, password });
        if (signInError) throw new Error(signInError.message ?? "Could not sign in.");
      } else {
        const { error: signUpError } = await authClient.signUp.email({
          email,
          password,
          name,
        });
        if (signUpError) throw new Error(signUpError.message ?? "Could not sign up.");

        // A venue owner without a venue has nothing to log in to, so the
        // organisation is created as part of signing up rather than as a
        // separate onboarding step.
        const base = slugify(venueName, "venue");
        // The apex serves /privacy, /terms, /login etc. as its own pages, so a
        // venue can't take those slugs — they'd be shadowed and unreachable.
        const slug = RESERVED_SLUGS.has(base) ? `${base}-venue` : base;

        const { error: orgError } = await authClient.organization.create({
          name: venueName,
          slug,
        });
        if (orgError) throw new Error(orgError.message ?? "Could not create the venue.");

        // The venue row (timezone, currency, policy) is not part of Better
        // Auth's organization table, so it is created server-side.
        const response = await fetch("/api/venue/init", { method: "POST" });
        if (!response.ok) throw new Error("Venue created, but setup failed.");
      }

      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Sign in or sign up"
        className="mb-6 inline-flex rounded-pill border border-rule bg-paper-2 p-1"
      >
        {(["signin", "signup"] as const).map((value) => (
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
              "whitespace-nowrap rounded-pill px-4 py-1.5 text-[0.875rem]",
              "transition-colors duration-[--dur-fast] ease-out",
              mode === value ? "bg-ink text-paper" : "text-ink-2 hover:text-ink",
            ].join(" ")}
          >
            {value === "signin" ? "Log in" : "Create a venue"}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="grid gap-4">
        {mode === "signup" ? (
          <>
            <label className="grid gap-1.5">
              <span className="text-[0.875rem] text-ink-2">Your name</span>
              <input name="name" required autoComplete="name" className={FIELD} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[0.875rem] text-ink-2">Venue name</span>
              <input
                name="venueName"
                required
                placeholder="Katipunan Padel"
                className={FIELD}
              />
            </label>
          </>
        ) : null}

        <label className="grid gap-1.5">
          <span className="text-[0.875rem] text-ink-2">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className={FIELD}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-[0.875rem] text-ink-2">
            Password{" "}
            {mode === "signup" ? (
              <span className="text-ink-3">(at least 10 characters)</span>
            ) : null}
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
          <p
            role="alert"
            className="rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.875rem] text-clay-ink"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy}>
          {busy
            ? "Working…"
            : mode === "signin"
              ? "Log in"
              : "Create venue"}
        </Button>
      </form>
    </>
  );
}
