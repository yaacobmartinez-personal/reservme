"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { impersonate } from "../../actions";

/**
 * Starts an impersonation, then opens the view with a client navigation.
 * A Server Action `redirect("/viewing")` would soft-match the apex [venueSlug]
 * route; router.push resolves to the host-rewritten /admin/viewing correctly.
 */
export function ImpersonateForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        await impersonate(new FormData(event.currentTarget));
        router.push("/viewing");
        router.refresh();
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input
        type="text"
        name="reason"
        placeholder="Reason (logged)"
        className="mr-2 h-10 w-48 rounded-sm border border-rule bg-card px-3 text-[0.875rem]"
      />
      <button
        type="submit"
        disabled={busy}
        className="h-10 whitespace-nowrap rounded-pill bg-ink px-4 text-[0.875rem] font-medium text-paper transition-opacity duration-[--dur-fast] ease-out hover:opacity-90 disabled:opacity-45"
      >
        {busy ? "Opening…" : "View as venue"}
      </button>
    </form>
  );
}
