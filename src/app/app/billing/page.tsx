import type { Metadata } from "next";
import { getBillingState, instapayConfig, listOrgPayments } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import { requireRole } from "@/lib/tenancy";
import { PaymentForm } from "./payment-form";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

function statusChip(
  state: Awaited<ReturnType<typeof getBillingState>>,
): { label: string; tone: string } {
  if (state.dueNow) return { label: "Due now", tone: "bg-clay-soft text-clay-ink" };
  if (state.status === "trialing")
    return {
      label: `Free trial · ${state.daysLeftInTrial ?? 0}d left`,
      tone: "bg-accent-soft text-accent-ink",
    };
  if (state.status === "comped") return { label: "Complimentary", tone: "bg-accent-soft text-accent-ink" };
  if (state.status === "cancelled") return { label: "Cancelled", tone: "bg-paper-3 text-ink-3" };
  return { label: "Active", tone: "bg-accent-soft text-accent-ink" };
}

const PAYMENT_TONE: Record<string, string> = {
  approved: "bg-accent-soft text-accent-ink",
  submitted: "bg-paper-3 text-ink-2",
  rejected: "bg-clay-soft text-clay-ink",
};

export default async function BillingPage() {
  const venue = await requireRole("owner", "admin");
  const [state, instapay, payments] = await Promise.all([
    getBillingState(venue.organizationId),
    instapayConfig(),
    listOrgPayments(venue.organizationId),
  ]);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: venue.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const chip = statusChip(state);
  const amount = state.amountDueCents;
  const fmt = (cents: number) => formatMoney(cents, "PHP");

  return (
    <main className="flex-1 py-8 sm:py-12">
      <div className="shell-wide">
        <h1 className="text-head">Billing</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          A flat monthly price by space count. First month free · 0% commission.
        </p>

        {/* Status tiles */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-paper-2 p-4">
            <p className="text-[0.8125rem] text-ink-3">Plan</p>
            <p className="mt-1 font-display text-2xl leading-none">{state.band.name}</p>
            <p className="mt-1 text-[0.75rem] text-ink-3">{venue.name}</p>
          </div>
          <div className="rounded-lg bg-paper-2 p-4">
            <p className="text-[0.8125rem] text-ink-3">Status</p>
            <span className={`mt-2 inline-block rounded-pill px-2.5 py-1 text-[0.8125rem] ${chip.tone}`}>
              {chip.label}
            </span>
          </div>
          <div className="rounded-lg bg-paper-2 p-4">
            <p className="text-[0.8125rem] text-ink-3">Monthly</p>
            <p className="mt-1 font-display text-2xl leading-none">
              {amount === null ? "By quote" : fmt(amount)}
            </p>
          </div>
        </div>

        {/* Pay panel */}
        <section className="mt-6 rounded-xl border border-rule bg-card p-5 shadow-plate sm:p-6">
          {state.pendingPayment ? (
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
                  <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M10 6v4l2.5 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <div>
                <h2 className="text-[0.9375rem] font-semibold">Payment under review</h2>
                <p className="mt-1 text-[0.875rem] text-ink-2">
                  We received your payment of {fmt(state.pendingPayment.amountCents)} (ref{" "}
                  <span className="font-mono">{state.pendingPayment.reference}</span>). We&rsquo;ll
                  confirm it shortly.
                </p>
              </div>
            </div>
          ) : amount === null ? (
            <p className="text-[0.9375rem] text-ink-2">
              Your plan is billed by quote. Please contact us to arrange payment.
            </p>
          ) : (
            <>
              <h2 className="text-[0.9375rem] font-semibold">Pay {fmt(amount)} via InstaPay</h2>
              {instapay.configured ? (
                <div className="mt-4 grid gap-6 sm:grid-cols-[190px_1fr]">
                  <div className="text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={instapay.qrUrl!}
                      alt="ReservMe InstaPay QR code"
                      className="mx-auto size-44 rounded-lg border border-rule bg-paper-2 object-contain"
                    />
                    <p className="mt-2 text-[0.75rem] text-ink-3">InstaPay · QR Ph</p>
                  </div>
                  <div>
                    <p className="text-[0.875rem] text-ink-2">
                      Payee <span className="font-medium text-ink">{instapay.payee}</span>
                      {instapay.account ? (
                        <>
                          {" "}
                          · <span className="font-mono">{instapay.account}</span>
                        </>
                      ) : null}
                      . Scan the code, send <span className="font-medium text-ink">exactly {fmt(amount)}</span>,
                      then enter your reference below.
                    </p>
                    <div className="mt-4">
                      <PaymentForm today={today} />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[0.9375rem] text-ink-2">
                  Bank transfer details are coming soon — please contact us to pay for now.
                </p>
              )}
            </>
          )}
        </section>

        {/* History */}
        {payments.length > 0 ? (
          <section className="mt-6">
            <h2 className="text-[0.9375rem] font-semibold">Payment history</h2>
            <ul className="mt-3 overflow-hidden rounded-lg border border-rule bg-card">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule p-3 text-[0.875rem] last:border-b-0"
                >
                  <span className="font-mono text-ink-2">{p.reference}</span>
                  <span className="tabular-nums">{fmt(p.amountCents)}</span>
                  <span className="text-[0.8125rem] text-ink-3">
                    {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: venue.timezone }).format(p.paidAt)}
                  </span>
                  <span className={`ml-auto rounded-pill px-2 py-0.5 text-[0.75rem] ${PAYMENT_TONE[p.status]}`}>
                    {p.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
