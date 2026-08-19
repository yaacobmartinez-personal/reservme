"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { authClient } from "@/lib/auth-client";

/** Switch the active venue to this one and open its dashboard. */
export function OpenVenue({ organizationId, isActive }: { organizationId: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (!isActive) await authClient.organization.setActive({ organizationId });
          router.replace("/");
          router.refresh();
        })
      }
      className="rounded-pill border border-rule-strong px-3.5 py-1.5 text-[0.8125rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:border-ink hover:text-ink disabled:opacity-45"
    >
      {isActive ? "Open" : "Switch"}
    </button>
  );
}
