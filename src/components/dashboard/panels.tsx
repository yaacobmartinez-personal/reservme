import {
  cancelBooking,
  checkInBooking,
  noShowBooking,
  undoCheckInBooking,
} from "@/app/app/booking-actions";
import { formatMoney } from "@/lib/money";
import type { DashboardData } from "@/lib/analytics";

/* ── Card wrapper ─────────────────────────────────────────────── */

export function Panel({
  title,
  hint,
  children,
  className = "",
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-rule bg-card p-5 shadow-plate sm:p-6 ${className}`}
    >
      {title ? (
        <header className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-sans text-[0.9375rem] font-semibold">{title}</h2>
          {hint ? <span className="text-[0.8125rem] text-ink-3">{hint}</span> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/* ── KPI tile ─────────────────────────────────────────────────── */

function Sparkline({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const w = 96;
  const h = 28;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pts = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-24 text-accent" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function KpiTile({
  label,
  value,
  deltaPct,
  series,
  higherIsBetter = true,
}: {
  label: string;
  value: string;
  deltaPct: number | null;
  series: number[];
  higherIsBetter?: boolean;
}) {
  const good =
    deltaPct === null ? null : higherIsBetter ? deltaPct >= 0 : deltaPct <= 0;
  return (
    <div className="rounded-xl border border-rule bg-card p-5 shadow-plate">
      <p className="text-[0.8125rem] text-ink-3">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="font-display text-3xl leading-none tracking-[-0.03em]">{value}</span>
        <Sparkline series={series} />
      </div>
      {deltaPct === null ? (
        <p className="mt-2 text-[0.75rem] text-ink-3">no prior period</p>
      ) : (
        <p
          className={[
            "mt-2 inline-flex items-center gap-1 text-[0.75rem] font-medium",
            good ? "text-accent" : "text-clay-ink",
          ].join(" ")}
        >
          <span aria-hidden="true">{deltaPct >= 0 ? "▲" : "▼"}</span>
          {Math.abs(deltaPct)}% vs previous
        </p>
      )}
    </div>
  );
}

/* ── Peak-hours heatmap ───────────────────────────────────────── */

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon…Sun, over Postgres DOW (0=Sun)
const DAY_LABEL = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function PeakHeatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[34rem]">
        <div className="flex gap-1 pl-7">
          {hours.map((h) => (
            <span
              key={h}
              className="w-4 text-center font-mono text-[0.5625rem] text-ink-3"
            >
              {h % 3 === 0 ? h : ""}
            </span>
          ))}
        </div>
        {DAY_ORDER.map((dow, row) => (
          <div key={dow} className="mt-1 flex items-center gap-1">
            <span className="w-6 font-mono text-[0.625rem] text-ink-3">{DAY_LABEL[dow]}</span>
            {hours.map((h) => {
              const n = grid[dow][h];
              const alpha = n === 0 ? 0 : 0.12 + (n / max) * 0.88;
              return (
                <span
                  key={h}
                  title={`${DAY_LABEL[dow]} ${String(h).padStart(2, "0")}:00 — ${n}`}
                  className="size-4 rounded-[3px] border border-rule/60"
                  style={{
                    background:
                      n === 0 ? "var(--color-paper-2)" : `oklch(48% 0.098 163 / ${alpha})`,
                  }}
                />
              );
            })}
            {/* row label doubles at the end for legend spacing */}
            {row === 0 ? null : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Customers ────────────────────────────────────────────────── */

export function CustomersPanel({ customers }: { customers: DashboardData["customers"] }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "New", value: customers.newCount },
          { label: "Returning", value: customers.returningCount },
          { label: "Repeat rate", value: `${customers.repeatRatePct}%` },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-paper-2 p-3">
            <p className="text-[0.75rem] text-ink-3">{s.label}</p>
            <p className="mt-1 font-display text-xl leading-none">{s.value}</p>
          </div>
        ))}
      </div>
      {customers.top.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {customers.top.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-3 text-[0.875rem]">
              <span className="truncate">{c.name}</span>
              <span className="font-mono text-ink-3">
                {c.bookings} booking{c.bookings === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[0.875rem] text-ink-3">No repeat customers yet.</p>
      )}
    </div>
  );
}

/* ── Needs you ────────────────────────────────────────────────── */

export function NeedsYou({
  needsYou,
  currency,
}: {
  needsYou: DashboardData["needsYou"];
  currency: string;
}) {
  const items: { text: string; tone: "warn" | "info" }[] = [];
  if (needsYou.awaitingPayments.count > 0) {
    items.push({
      text: `${needsYou.awaitingPayments.count} payment${needsYou.awaitingPayments.count === 1 ? "" : "s"} to verify · ${formatMoney(needsYou.awaitingPayments.cents, currency)}`,
      tone: "warn",
    });
  }
  if (needsYou.toCheckIn > 0) {
    items.push({ text: `${needsYou.toCheckIn} still to check in today`, tone: "info" });
  }
  for (const s of needsYou.halfEmptySessions) {
    items.push({
      text: `${s.title} (${s.label}) — ${s.left} of ${s.capacity} spots left`,
      tone: "info",
    });
  }

  if (items.length === 0) {
    return <p className="text-[0.875rem] text-ink-3">Nothing needs you right now. Nice.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li
          key={i}
          className={[
            "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[0.875rem]",
            it.tone === "warn"
              ? "border-clay/40 bg-clay-soft text-clay-ink"
              : "border-rule bg-paper-2 text-ink-2",
          ].join(" ")}
        >
          <span
            aria-hidden="true"
            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${it.tone === "warn" ? "bg-clay" : "bg-accent"}`}
          />
          {it.text}
        </li>
      ))}
    </ul>
  );
}

/* ── Run sheet (extracted, with actions) ──────────────────────── */

type RunRow = {
  id: string;
  reference: string;
  space_name: string;
  customer_name: string | null;
  customer_phone: string | null;
  label: string;
  status: string;
  kind: string;
  party_size: number;
  amount_cents: number;
  checked_in_at: Date | null;
};

const RS_VARIANT = {
  solid: "border-ink bg-ink text-paper hover:opacity-90",
  plain: "border-rule text-ink-2 hover:border-rule-strong hover:text-ink",
  danger: "border-rule text-ink-3 hover:border-clay/50 hover:text-clay-ink",
} as const;

function RsButton({
  action,
  id,
  label,
  variant = "plain",
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  label: string;
  variant?: keyof typeof RS_VARIANT;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="reservationId" value={id} />
      <button
        type="submit"
        className={`whitespace-nowrap rounded-pill border px-3 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-fast] ease-out ${RS_VARIANT[variant]}`}
      >
        {label}
      </button>
    </form>
  );
}

export function RunSheet({
  runSheet,
  currency,
}: {
  runSheet: RunRow[];
  currency: string;
}) {
  if (runSheet.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-rule-strong bg-paper-2 p-8 text-center text-[0.9375rem] text-ink-3">
        Nothing booked today yet.
      </p>
    );
  }
  return (
    <ul className="overflow-hidden rounded-lg border border-rule bg-card">
      {runSheet.map((b) => {
        const checkedIn = b.checked_in_at !== null;
        return (
          <li
            key={b.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-rule p-4 last:border-b-0"
          >
            <span className="w-24 shrink-0 font-mono text-[0.875rem]">{b.label}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{b.customer_name ?? "Walk-in"}</span>
              <span className="block truncate text-[0.875rem] text-ink-3">
                {b.space_name}
                {b.kind === "session_seat"
                  ? ` · ${b.party_size} spot${b.party_size === 1 ? "" : "s"}`
                  : ""}
                {b.customer_phone ? ` · ${b.customer_phone}` : ""}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[0.875rem] text-ink-2">
              {formatMoney(b.amount_cents, currency)}
            </span>
            <span
              className={[
                "label shrink-0 rounded-pill border px-2.5 py-1",
                checkedIn ? "border-accent bg-accent text-on-accent" : "border-rule text-ink-3",
              ].join(" ")}
            >
              {checkedIn ? "Checked in" : "Confirmed"}
            </span>
            <div className="flex w-full items-center gap-1.5 sm:w-auto">
              {b.status === "confirmed" ? (
                checkedIn ? (
                  <RsButton action={undoCheckInBooking} id={b.id} label="Undo" />
                ) : (
                  <>
                    <RsButton action={checkInBooking} id={b.id} label="Check in" variant="solid" />
                    <RsButton action={noShowBooking} id={b.id} label="No-show" />
                  </>
                )
              ) : null}
              <RsButton action={cancelBooking} id={b.id} label="Cancel" variant="danger" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
