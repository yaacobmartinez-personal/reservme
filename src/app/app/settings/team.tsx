"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import type { PendingInvite, TeamMember } from "@/lib/team";

/**
 * Staff / team management. Reads are server-rendered; mutations go through Better
 * Auth's organization plugin. Owner/admin only for the write controls; the list
 * itself is visible to any member.
 */
export function TeamSection({
  organizationId,
  members,
  invites,
  canManage,
}: {
  organizationId: string;
  members: TeamMember[];
  invites: PendingInvite[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function act(fn: () => Promise<{ error?: { message?: string } | null }>) {
    setError(null);
    startTransition(async () => {
      const { error: e } = await fn();
      if (e) setError(e.message ?? "Something went wrong.");
      else router.refresh();
    });
  }

  function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const role = String(fd.get("role") ?? "member") as "admin" | "member";
    e.currentTarget.reset();
    act(() => authClient.organization.inviteMember({ email, role, organizationId }));
  }

  const roleChip = "rounded-pill bg-paper-3 px-2 py-0.5 text-[0.75rem] text-ink-2";

  return (
    <section className="mt-6 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
      <h2 className="text-xl">Team</h2>
      <p className="mt-1 text-[0.875rem] text-ink-3">
        Invite staff to help run the venue. Admins can manage everything; members
        run the day (bookings, check-ins).
      </p>

      <ul className="mt-5 divide-y divide-rule overflow-hidden rounded-lg border border-rule">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{m.name}</span>
              <span className="block truncate text-[0.8125rem] text-ink-3">{m.email}</span>
            </span>
            <span className={roleChip}>{m.role}</span>
            {canManage && m.role !== "owner" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  act(() => authClient.organization.removeMember({ memberIdOrEmail: m.email, organizationId }))
                }
                className="text-[0.8125rem] text-ink-3 hover:text-clay-ink disabled:opacity-45"
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {invites.length > 0 ? (
        <div className="mt-4">
          <p className="label text-ink-3">Pending invites</p>
          <ul className="mt-2 divide-y divide-rule overflow-hidden rounded-lg border border-dashed border-rule-strong">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <span className="min-w-0 flex-1 truncate text-[0.875rem]">{i.email}</span>
                <span className={roleChip}>{i.role}</span>
                {canManage ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      act(() => authClient.organization.cancelInvitation({ invitationId: i.id }))
                    }
                    className="text-[0.8125rem] text-ink-3 hover:text-clay-ink disabled:opacity-45"
                  >
                    Cancel
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canManage ? (
        <form onSubmit={invite} className="mt-5 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[0.8125rem] text-ink-2">
            <span>Invite by email</span>
            <input
              name="email"
              type="email"
              required
              placeholder="staff@email.com"
              className="h-10 w-64 max-w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.875rem]"
            />
          </label>
          <select
            name="role"
            defaultValue="member"
            className="h-10 rounded-sm border border-rule bg-paper-2 px-2 text-[0.875rem] text-ink-2"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={pending}
            className="h-10 rounded-pill bg-ink px-4 text-[0.8125rem] font-medium text-paper hover:opacity-90 disabled:opacity-45"
          >
            {pending ? "Sending…" : "Send invite"}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.8125rem] text-clay-ink">
          {error}
        </p>
      ) : null}
    </section>
  );
}
