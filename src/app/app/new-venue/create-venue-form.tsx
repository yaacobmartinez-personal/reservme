"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { RESERVED_SLUGS } from "@/content/legal";
import { authClient } from "@/lib/auth-client";
import { slugify } from "@/lib/slug";

const FIELD = "h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";

export function CreateVenueForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const venueName = String(new FormData(event.currentTarget).get("venueName") ?? "").trim();

    try {
      const base = slugify(venueName, "venue");
      const wanted = RESERVED_SLUGS.has(base) ? `${base}-venue` : base;

      // Slugs are globally unique; if it's taken, try once with a short suffix.
      let created: { id: string } | null = null;
      for (const slug of [wanted, `${base}-${Math.random().toString(36).slice(2, 6)}`]) {
        const { data, error: orgError } = await authClient.organization.create({ name: venueName, slug });
        if (data) {
          created = data;
          break;
        }
        if (orgError && !/slug/i.test(orgError.message ?? "")) {
          throw new Error(orgError.message ?? "Could not create the venue.");
        }
      }
      if (!created) throw new Error("Could not find a free address for that name — try another.");

      const res = await fetch("/api/venue/init", { method: "POST" });
      if (!res.ok) throw new Error("Venue created, but setup failed.");

      await authClient.organization.setActive({ organizationId: created.id });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-[0.875rem] text-ink-2">Venue name</span>
        <input name="venueName" required placeholder="Katipunan Padel — Ortigas" className={FIELD} />
      </label>
      {error ? (
        <p role="alert" className="rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.875rem] text-clay-ink">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy}>
        {busy ? "Creating…" : "Create venue"}
      </Button>
    </form>
  );
}
