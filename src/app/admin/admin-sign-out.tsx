"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminAuthClient } from "@/lib/admin/auth-client";

export function AdminSignOut({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await adminAuthClient.signOut();
        router.push("/login");
        router.refresh();
      }}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border border-rule-strong px-3 py-2 text-[0.875rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:border-ink hover:text-ink disabled:opacity-45 ${className}`}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
