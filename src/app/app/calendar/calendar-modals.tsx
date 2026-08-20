"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import {
  cancelBooking,
  checkInBooking,
  noShowBooking,
  undoCheckInBooking,
} from "@/app/app/booking-actions";
import { blockOff, removeBlock } from "@/app/app/calendar-actions";
import type { CalendarBlock } from "@/lib/calendar";
import { formatMoney } from "@/lib/money";

/* ── Block detail popover ─────────────────────────────────────── */

const DETAIL_BTN =
  "rounded-pill px-3.5 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-fast] ease-out";

export function BlockDetail({
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

export function BlockOffPanel({
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
