import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { getAuditLog } from "@/lib/admin/audit";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  "admin.viewed_tenant": "Opened tenant",
  "admin.suspended_venue": "Suspended venue",
  "admin.reactivated_venue": "Reactivated venue",
  "admin.impersonation_started": "Started viewing as",
  "admin.impersonation_ended": "Stopped viewing as",
  "admin.granted_admin": "Granted platform admin",
  "admin.revoked_admin": "Revoked platform admin",
};

export default async function AuditPage() {
  await requirePlatformAdmin();
  const entries = await getAuditLog(200);

  return (
    <main className="flex-1 py-10 sm:py-14">
      <div className="shell">
        <h1 className="text-head">Audit log</h1>
        <p className="mt-2 max-w-2xl text-[0.9375rem] text-ink-2">
          Every cross-tenant action, attributed to the real person who took it —
          including actions taken while viewing as a venue.
        </p>

        <div className="mt-8 overflow-x-auto rounded-lg border border-rule bg-card shadow-plate">
          <table className="w-full min-w-[48rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule">
                {["When", "Who", "Did what", "To", "From"].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="label px-4 py-3 font-sans text-ink-3"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-3">
                    Nothing recorded yet.
                  </td>
                </tr>
              ) : null}

              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-rule last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[0.8125rem] text-ink-2">
                    {new Intl.DateTimeFormat("en-PH", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(entry.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="block text-[0.9375rem]">{entry.actorName}</span>
                    <span className="block truncate text-[0.75rem] text-ink-3">
                      {entry.actorEmail}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[0.9375rem]">
                    {ACTION_LABEL[entry.action] ?? entry.action}
                    {entry.impersonating ? (
                      <span className="label ml-2 rounded-pill border border-clay/40 bg-clay-soft px-2 py-0.5 text-clay-ink">
                        while viewing as
                      </span>
                    ) : null}
                    {entry.detail && typeof entry.detail.reason === "string" ? (
                      <span className="block text-[0.8125rem] text-ink-3">
                        “{entry.detail.reason}”
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-[0.9375rem]">
                    {entry.organizationName ?? entry.target ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[0.75rem] text-ink-3">
                    {entry.ip ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
