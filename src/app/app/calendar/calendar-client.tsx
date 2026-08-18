"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  cancelBooking,
  checkInBooking,
  noShowBooking,
  undoCheckInBooking,
} from "@/app/app/booking-actions";
import { blockOff, removeBlock } from "@/app/app/calendar-actions";
import type { CalendarBlock, CalendarDay } from "@/lib/calendar";
import { formatMoney } from "@/lib/money";
import { BookingPanel, type PanelState } from "./booking-panel";

const PX_PER_HOUR = 56;
const pxPerMin = PX_PER_HOUR / 60;

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function minToTime(min: number) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}
function shiftDate(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function longDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const BLOCK_STYLE: Record<string, string> = {
  confirmed: "bg-accent-soft text-accent-ink border border-accent-line",
  checked_in: "bg-accent text-on-accent border border-accent",
  no_show: "bg-clay-soft text-clay-ink border border-clay/40",
  held: "bg-paper-3 text-ink-2 border border-dashed border-rule-strong",
  session: "bg-paper-2 text-ink-2 border border-dashed border-rule-strong",
};

function rentalTone(b: CalendarBlock): string {
  if (b.status === "no_show") return BLOCK_STYLE.no_show;
  if (b.status === "held") return BLOCK_STYLE.held;
  if (b.checkedIn) return BLOCK_STYLE.checked_in;
  return BLOCK_STYLE.confirmed;
}

export function CalendarClient({
  day,
  date,
  today,
  currency,
}: {
  day: CalendarDay;
  date: string;
  today: string;
  currency: string;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [detail, setDetail] = useState<CalendarBlock | null>(null);
  const [blocking, setBlocking] = useState(false);

  const { columns, blocks, openMin, closeMin } = day;
  const axisHeight = (closeMin - openMin) * pxPerMin;
  const hours: number[] = [];
  for (let m = openMin; m <= closeMin; m += 60) hours.push(m);

  const venueClosures = blocks.filter((b) => b.type === "closure" && b.spaceId === null);

  const go = (d: string) => router.push(`/calendar?date=${d}`);
  const refresh = () => {
    setPanel(null);
    setDetail(null);
    router.refresh();
  };

  return (
    <main className="flex-1 py-6 sm:py-8">
      <div className="shell max-w-6xl">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-head">Calendar</h1>
          <div className="flex items-center overflow-hidden rounded-lg border border-rule">
            <button
              type="button"
              onClick={() => go(shiftDate(date, -1))}
              aria-label="Previous day"
              className="px-2.5 py-1.5 hover:bg-paper-2"
            >
              <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true"><path d="M12 5l-5 5 5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <span className="min-w-[7.5rem] border-x border-rule px-3 py-1.5 text-center text-[0.875rem]">
              {longDate(date)}
            </span>
            <button
              type="button"
              onClick={() => go(shiftDate(date, 1))}
              aria-label="Next day"
              className="px-2.5 py-1.5 hover:bg-paper-2"
            >
              <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true"><path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          {date !== today ? (
            <button
              type="button"
              onClick={() => go(today)}
              className="rounded-pill border border-rule px-3 py-1.5 text-[0.8125rem] text-ink-2 hover:border-rule-strong hover:text-ink"
            >
              Today
            </button>
          ) : null}
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && go(e.target.value)}
            aria-label="Pick a date"
            className="h-9 rounded-sm border border-rule bg-paper-2 px-2 text-[0.8125rem] text-ink-2"
          />
          <button
            type="button"
            onClick={() => setBlocking(true)}
            className="ml-auto rounded-pill border border-rule-strong px-3.5 py-1.5 text-[0.8125rem] text-ink-2 hover:border-ink hover:text-ink"
          >
            Block off
          </button>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-ink-3">
          <Legend className="bg-accent-soft border border-accent-line" label="Confirmed" />
          <Legend className="bg-accent" label="Checked in" />
          <Legend className="bg-clay-soft border border-clay/40" label="No-show" />
          <Legend className="bg-paper-2 border border-dashed border-rule-strong" label="Session" />
          <span className="ml-auto hidden sm:inline">Click an empty slot to book</span>
        </div>

        {columns.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-rule-strong bg-paper-2 p-10 text-center text-[0.9375rem] text-ink-3">
            No active spaces yet. Add one in Spaces and it becomes a column here.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-rule bg-card shadow-plate">
            <div className="min-w-[36rem]">
              {/* Column headers */}
              <div className="flex border-b border-rule">
                <div className="w-12 shrink-0" />
                {columns.map((c) => (
                  <div
                    key={c.id}
                    className="flex-1 border-l border-rule px-2 py-2 text-center text-[0.8125rem] font-medium"
                  >
                    <span className="block truncate">{c.name}</span>
                  </div>
                ))}
              </div>

              {/* Grid body */}
              <div className="relative flex" style={{ height: axisHeight }}>
                {/* Hour gutter + lines */}
                <div className="relative w-12 shrink-0">
                  {hours.map((m) => (
                    <span
                      key={m}
                      style={{ top: (m - openMin) * pxPerMin }}
                      className="absolute right-1.5 -translate-y-1/2 font-mono text-[0.625rem] text-ink-3"
                    >
                      {minToTime(m)}
                    </span>
                  ))}
                </div>

                {columns.map((c) => {
                  const slotCount = Math.max(1, Math.floor((closeMin - openMin) / c.slotMinutes));
                  const colBlocks = blocks.filter((b) => b.spaceId === c.id);
                  return (
                    <div key={c.id} className="relative flex-1 border-l border-rule">
                      {/* hour gridlines */}
                      {hours.map((m) => (
                        <div
                          key={m}
                          style={{ top: (m - openMin) * pxPerMin }}
                          className="pointer-events-none absolute inset-x-0 border-t border-rule/60"
                        />
                      ))}
                      {/* empty slot underlay */}
                      {Array.from({ length: slotCount }, (_, i) => {
                        const startMin = openMin + i * c.slotMinutes;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() =>
                              setPanel({ mode: "create", spaceId: c.id, time: minToTime(startMin) })
                            }
                            style={{
                              top: (startMin - openMin) * pxPerMin,
                              height: c.slotMinutes * pxPerMin,
                            }}
                            className="group absolute inset-x-0 flex items-center justify-center text-accent-ink/0 hover:bg-accent-soft/40 hover:text-accent-ink"
                            aria-label={`Book ${c.name} at ${minToTime(startMin)}`}
                          >
                            <span className="text-sm opacity-0 group-hover:opacity-100">+</span>
                          </button>
                        );
                      })}
                      {/* blocks */}
                      {colBlocks.map((b) => (
                        <BlockChip
                          key={`${b.type}-${b.id}`}
                          block={b}
                          openMin={openMin}
                          currency={currency}
                          onClick={() => setDetail(b)}
                        />
                      ))}
                    </div>
                  );
                })}

                {/* Venue-wide closures span every column */}
                {venueClosures.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setDetail(b)}
                    style={{
                      top: (b.startMin - openMin) * pxPerMin,
                      height: Math.max(16, (b.endMin - b.startMin) * pxPerMin),
                      left: "3rem",
                    }}
                    className="absolute right-0 flex items-center px-2 text-[0.6875rem] text-ink-3"
                  >
                    <span
                      className="flex h-full w-full items-center rounded-[4px] px-2"
                      style={{
                        background:
                          "repeating-linear-gradient(45deg, var(--color-paper-2), var(--color-paper-2) 5px, var(--color-paper-3) 5px, var(--color-paper-3) 9px)",
                      }}
                    >
                      {b.title} · {b.startLabel}–{b.endLabel}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {panel ? (
        <BookingPanel
          state={panel}
          date={date}
          columns={columns}
          onClose={() => setPanel(null)}
          onDone={refresh}
        />
      ) : null}

      {detail ? (
        <BlockDetail
          block={detail}
          currency={currency}
          onClose={() => setDetail(null)}
          onReschedule={(b) => {
            setDetail(null);
            setPanel({
              mode: "move",
              reservationId: b.id,
              spaceId: b.spaceId ?? columns[0]?.id ?? "",
              time: b.startLabel,
              who: b.title,
            });
          }}
          onChanged={refresh}
        />
      ) : null}

      {blocking ? (
        <BlockOffPanel
          date={date}
          columns={columns}
          onClose={() => setBlocking(false)}
          onDone={refresh}
        />
      ) : null}
    </main>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-3 rounded-[3px] ${className}`} />
      {label}
    </span>
  );
}

function BlockChip({
  block,
  openMin,
  currency,
  onClick,
}: {
  block: CalendarBlock;
  openMin: number;
  currency: string;
  onClick: () => void;
}) {
  const top = (block.startMin - openMin) * pxPerMin;
  const height = Math.max(16, (block.endMin - block.startMin) * pxPerMin);

  if (block.type === "closure") {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{ top, height }}
        className="absolute inset-x-0.5 overflow-hidden rounded-[4px] text-left"
      >
        <span
          className="flex h-full w-full items-center rounded-[3px] px-1.5 text-[0.625rem] text-ink-3"
          style={{
            background:
              "repeating-linear-gradient(45deg, var(--color-paper-2), var(--color-paper-2) 5px, var(--color-paper-3) 5px, var(--color-paper-3) 9px)",
          }}
        >
          <span className="truncate">{block.title}</span>
        </span>
      </button>
    );
  }

  const tone = block.type === "session" ? BLOCK_STYLE.session : rentalTone(block);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ top, height }}
      className={`absolute inset-x-0.5 overflow-hidden rounded-[4px] px-1.5 py-1 text-left ${tone}`}
    >
      <span className="block truncate text-[0.6875rem] font-medium leading-tight">{block.title}</span>
      <span className="block truncate text-[0.625rem] opacity-90">
        {block.type === "session"
          ? block.subtitle
          : `${block.startLabel} · ${formatMoney(block.amountCents ?? 0, currency)}`}
      </span>
    </button>
  );
}

/* ── Block detail popover ─────────────────────────────────────── */

const DETAIL_BTN =
  "rounded-pill px-3.5 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-fast] ease-out";

function BlockDetail({
  block,
  currency,
  onClose,
  onReschedule,
  onChanged,
}: {
  block: CalendarBlock;
  currency: string;
  onClose: () => void;
  onReschedule: (b: CalendarBlock) => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const run = (action: (fd: FormData) => Promise<unknown>) => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("reservationId", block.id);
      await action(fd);
      onChanged();
    });
  };

  const removeClosure = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("closureId", block.id);
      await removeBlock(fd);
      onChanged();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/20" />
      <div className="relative w-full max-w-sm rounded-xl border border-rule bg-card p-5 shadow-float">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-medium">
              {block.type === "rental" && block.customerId ? (
                <Link href={`/customers/${block.customerId}`} className="hover:text-accent">
                  {block.title}
                </Link>
              ) : (
                block.title
              )}
            </h2>
            <p className="mt-0.5 text-[0.8125rem] text-ink-3">
              {block.startLabel}–{block.endLabel}
              {block.type === "rental" && block.partySize && block.partySize > 1
                ? ` · party of ${block.partySize}`
                : ""}
              {block.type === "session" ? ` · ${block.subtitle}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-3 hover:text-ink">
            <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>

        {block.type === "rental" ? (
          <>
            <p className="mt-3 font-mono text-[0.9375rem]">
              {formatMoney(block.amountCents ?? 0, currency)}
              <span className="ml-2 text-[0.75rem] text-ink-3">
                {block.status === "no_show" ? "no-show" : block.checkedIn ? "checked in" : "confirmed"}
              </span>
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {block.status === "confirmed" ? (
                block.checkedIn ? (
                  <button type="button" disabled={pending} onClick={() => run(undoCheckInBooking)} className={`${DETAIL_BTN} border border-rule text-ink-2 hover:border-rule-strong hover:text-ink`}>
                    Undo check-in
                  </button>
                ) : (
                  <>
                    <button type="button" disabled={pending} onClick={() => run(checkInBooking)} className={`${DETAIL_BTN} bg-accent text-on-accent hover:bg-accent-hover`}>
                      Check in
                    </button>
                    <button type="button" disabled={pending} onClick={() => run(noShowBooking)} className={`${DETAIL_BTN} border border-rule text-ink-2 hover:border-rule-strong hover:text-ink`}>
                      No-show
                    </button>
                  </>
                )
              ) : null}
              {block.status !== "no_show" ? (
                <button type="button" disabled={pending} onClick={() => onReschedule(block)} className={`${DETAIL_BTN} border border-rule text-ink-2 hover:border-rule-strong hover:text-ink`}>
                  Reschedule
                </button>
              ) : null}
              <button type="button" disabled={pending} onClick={() => run(cancelBooking)} className={`${DETAIL_BTN} text-ink-3 hover:text-clay-ink`}>
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {block.type === "session" ? (
          <p className="mt-3 text-[0.875rem] text-ink-2">
            Open-play session. Manage seats and check-ins from the run sheet on Today.
          </p>
        ) : null}

        {block.type === "closure" ? (
          <div className="mt-4 flex justify-end">
            <button type="button" disabled={pending} onClick={removeClosure} className={`${DETAIL_BTN} border border-rule text-ink-2 hover:border-clay/50 hover:text-clay-ink`}>
              Remove block
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Block-off panel ──────────────────────────────────────────── */

function BlockOffPanel({
  date,
  columns,
  onClose,
  onDone,
}: {
  date: string;
  columns: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const field = "h-10 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.875rem]";
  const label = "grid gap-1 text-[0.8125rem] text-ink-2";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/20" />
      <div className="relative w-full max-w-sm rounded-xl border border-rule bg-card p-5 shadow-float">
        <h2 className="text-[0.9375rem] font-semibold">Block off time</h2>
        <p className="mt-1 text-[0.8125rem] text-ink-3">Closes a range so nothing can be booked in it.</p>
        <form
          ref={ref}
          onSubmit={(e) => {
            e.preventDefault();
            const form = ref.current;
            if (!form) return;
            setError(null);
            const fd = new FormData(form);
            startTransition(async () => {
              const result = await blockOff(fd);
              if (result.ok) onDone();
              else setError(result.error);
            });
          }}
          className="mt-4 grid gap-3"
        >
          <input type="hidden" name="date" value={date} />
          <label className={label}>
            <span>Space</span>
            <select name="spaceId" defaultValue="" className={field}>
              <option value="">Whole venue</option>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              <span>From</span>
              <input type="time" name="startTime" required defaultValue="12:00" className={field} />
            </label>
            <label className={label}>
              <span>To</span>
              <input type="time" name="endTime" required defaultValue="13:00" className={field} />
            </label>
          </div>
          <label className={label}>
            <span>Reason (optional)</span>
            <input name="reason" placeholder="Maintenance, private event…" className={field} />
          </label>
          {error ? (
            <p className="rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.8125rem] text-clay-ink">
              {error}
            </p>
          ) : null}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-pill border border-rule px-4 py-2 text-[0.8125rem] text-ink-2 hover:border-rule-strong hover:text-ink">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="rounded-pill bg-ink px-5 py-2 text-[0.8125rem] font-medium text-paper hover:opacity-90 disabled:opacity-45">
              {pending ? "Blocking…" : "Block off"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
