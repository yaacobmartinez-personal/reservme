"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="outline"
      disabled={busy}
      className={className}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
