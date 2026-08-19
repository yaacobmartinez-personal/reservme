"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import type { UserVenue } from "@/lib/portfolio";

/**
 * Switches the active venue for owners who run more than one. Uses Better Auth's
 * setActive; the whole app re-resolves from the new active organization.
 */
export function VenueSwitcher({
  currentOrgId,
  currentName,
  venues,
}: {
  currentOrgId: string;
  currentName: string;
  venues: UserVenue[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const multi = venues.length > 1;

  return (
    <div className="grid gap-1.5 px-2">
      {multi ? (
        <select
          value={currentOrgId}
          disabled={pending}
          aria-label="Switch venue"
          onChange={(e) => {
            const organizationId = e.target.value;
            startTransition(async () => {
              await authClient.organization.setActive({ organizationId });
              router.replace("/");
              router.refresh();
            });
          }}
          className="h-9 w-full truncate rounded-sm border border-rule bg-paper-2 px-2 text-[0.8125rem] text-ink-2"
        >
          {venues.map((v) => (
            <option key={v.organizationId} value={v.organizationId}>
              {v.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="truncate pb-1 text-[0.8125rem] text-ink-3">{currentName}</p>
      )}
      <div className="flex items-center gap-3 text-[0.75rem]">
        {multi ? (
          <Link href="/portfolio" className="text-ink-3 hover:text-ink">
            All venues
          </Link>
        ) : null}
        <Link href="/new-venue" className="text-ink-3 hover:text-accent">
          ＋ New venue
        </Link>
      </div>
    </div>
  );
}
