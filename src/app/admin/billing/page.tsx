import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { type BillingRow, instapayConfig, listBilling, listSubmittedPayments } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import { QrField } from "./qr-field";
import {
  approveBillingPayment,
  compSubscription,
  markPaidUntil,
  rejectBillingPayment,
  updateBillingConfig,
} from "../billing-actions";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

function stateChip(row: BillingRow): { label: string; tone: string } {
  if (row.dueNow) return { label: "due now", tone: "bg-clay-soft text-clay-ink" };
  if (row.status === "trialing")
    return { label: `trial · ${row.daysLeftInTrial ?? 0}d`, tone: "bg-paper-3 text-ink-2" };
  if (row.status === "comped") return { label: "comped", tone: "bg-accent-soft text-accent-ink" };
  if (row.status === "cancelled") return { label: "cancelled", tone: "bg-paper-3 text-ink-3" };
  return {
    label: row.paidUntil
      ? `active · to ${new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(row.paidUntil)}`
      : "active",
    tone: "bg-accent-soft text-accent-ink",
  };
}

const fmt = (cents: number | null) => (cents === null ? "By quote" : formatMoney(cents, "PHP"));
const FIELD = "h-9 rounded-sm border border-rule bg-paper-2 px-2 text-[0.8125rem]";

/** A convenient "mark paid until" default — a month out, as YYYY-MM-DD. */
function defaultPaidUntil(): string {
  return new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
}

export default async function AdminBillingPage() {
  await requirePlatformAdmin();
  const [submitted, rows, instapay] = await Promise.all([
    listSubmittedPayments(),
    listBilling(),
    instapayConfig(),
  ]);

  const monthOut = defaultPaidUntil();

  return (
    <main className="flex-1 py-10 sm:py-14">
      <div className="shell">
        <h1 className="text-head">Billing</h1>

        {/* Awaiting verification */}
        <section className="mt-8">
          <h2 className="text-xl">Awaiting verification ({submitted.length})</h2>
          {submitted.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-rule-strong bg-paper-2 p-6 text-center text-[0.9375rem] text-ink-3">
              No payments to review.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {submitted.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-rule bg-card p-4 shadow-plate"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.venueName}</p>
                    <p className="mt-0.5 text-[0.8125rem] text-ink-3">
                      Ref <span className="font-mono">{p.reference}</span> · paid{" "}
                      {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(p.paidAt)}
                    </p>
                  </div>
                  <span className="font-mono text-[0.9375rem]">{formatMoney(p.amountCents, "PHP")}</span>
                  <div className="flex gap-2">
                    <form action={approveBillingPayment}>
                      <input type="hidden" name="paymentId" value={p.id} />
                      <button
                        type="submit"
                        className="rounded-pill bg-accent px-4 py-1.5 text-[0.8125rem] font-medium text-on-accent hover:bg-accent-hover"
                      >
                        Approve
                      </button>
                    </form>
                    <form action={rejectBillingPayment}>
                      <input type="hidden" name="paymentId" value={p.id} />
                      <button
                        type="submit"
                        className="rounded-pill border border-rule-strong px-4 py-1.5 text-[0.8125rem] text-ink-2 hover:border-clay/50 hover:text-clay-ink"
                      >
                        Reject
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* All venues */}
        <section className="mt-10">
          <h2 className="text-xl">All venues</h2>
          <div className="mt-4 overflow-x-auto rounded-lg border border-rule bg-card shadow-plate">
            <table className="w-full min-w-[48rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule">
                  {["Venue", "Plan", "Status", "Manual"].map((h) => (
                    <th key={h} scope="col" className="label px-4 py-3 font-sans text-ink-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const chip = stateChip(row);
                  return (
                    <tr key={row.organizationId} className="border-b border-rule last:border-b-0">
                      <td className="px-4 py-3 font-medium">{row.name}</td>
                      <td className="px-4 py-3 text-[0.9375rem]">
                        {row.band.name} · {fmt(row.amountDueCents)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-pill px-2.5 py-1 text-[0.8125rem] ${chip.tone}`}>
                          {chip.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={markPaidUntil} className="flex items-center gap-1.5">
                            <input type="hidden" name="organizationId" value={row.organizationId} />
                            <input type="date" name="paidUntil" defaultValue={monthOut} className={FIELD} />
                            <button
                              type="submit"
                              className="rounded-pill border border-rule-strong px-3 py-1.5 text-[0.8125rem] text-ink-2 hover:border-ink hover:text-ink"
                            >
                              Mark paid
                            </button>
                          </form>
                          {row.status !== "comped" ? (
                            <form action={compSubscription}>
                              <input type="hidden" name="organizationId" value={row.organizationId} />
                              <button
                                type="submit"
                                className="rounded-pill px-3 py-1.5 text-[0.8125rem] text-ink-3 hover:bg-paper-3 hover:text-ink"
                              >
                                Comp
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* InstaPay QR settings */}
        <section className="mt-10 max-w-xl rounded-xl border border-rule bg-card p-6 shadow-float">
          <h2 className="text-xl">ReservMe InstaPay details</h2>
          <p className="mt-1 text-[0.875rem] text-ink-3">
            Shown to owners on their billing page. Upload the QR Ph code image or paste a hosted URL.
            {instapay.configured ? " Currently set." : " Not set — owners see a “contact us” message."}
          </p>
          <form action={updateBillingConfig} className="mt-5 grid gap-4">
            <QrField initial={instapay.qrUrl} />
            <label className="grid gap-1.5 text-[0.875rem] text-ink-2">
              <span>Payee name</span>
              <input
                name="payee"
                defaultValue={instapay.payee ?? ""}
                placeholder="ReservMe Inc."
                className="h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]"
              />
            </label>
            <label className="grid gap-1.5 text-[0.875rem] text-ink-2">
              <span>Account label</span>
              <input
                name="account"
                defaultValue={instapay.account ?? ""}
                placeholder="BPI ••• 1234"
                className="h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]"
              />
            </label>
            <div>
              <button
                type="submit"
                className="rounded-pill bg-ink px-5 py-2 text-[0.875rem] font-medium text-paper hover:opacity-90"
              >
                Save details
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
