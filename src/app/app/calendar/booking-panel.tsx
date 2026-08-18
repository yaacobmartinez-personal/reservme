"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  type BookingResult,
  type CustomerHit,
  createManualBooking,
  moveReservation,
  searchCustomers,
} from "@/app/app/calendar-actions";

type Column = { id: string; name: string; slotMinutes: number };

export type PanelState =
  | { mode: "create"; spaceId: string; time: string }
  | {
      mode: "move";
      reservationId: string;
      spaceId: string;
      time: string;
      who: string;
    };

const FIELD =
  "h-10 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.875rem]";
const LABEL = "grid gap-1 text-[0.8125rem] text-ink-2";

function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr${h === 1 ? "" : "s"}`;
  return `${h} hr ${m} min`;
}

export function BookingPanel({
  state,
  date,
  columns,
  onClose,
  onDone,
}: {
  state: PanelState;
  date: string;
  columns: Column[];
  onClose: () => void;
  onDone: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const column =
    columns.find((c) => c.id === state.spaceId) ?? columns[0];
  const slot = column?.slotMinutes ?? 60;

  function submit(action: (fd: FormData) => Promise<BookingResult>) {
    const form = formRef.current;
    if (!form) return;
    setError(null);
    const fd = new FormData(form);
    startTransition(async () => {
      const result = await action(fd);
      if (result.ok) onDone();
      else setError(result.error);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* scrim */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/20"
      />
      <div className="relative flex w-full max-w-sm flex-col overflow-y-auto border-l border-rule bg-card shadow-float">
        <div className="flex items-center justify-between border-b border-rule px-5 py-4">
          <h2 className="text-[0.9375rem] font-semibold">
            {state.mode === "create" ? "New booking" : "Reschedule"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-3 hover:text-ink"
          >
            <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            submit(state.mode === "create" ? createManualBooking : moveReservation);
          }}
          className="grid gap-4 px-5 py-5"
        >
          <input type="hidden" name="date" value={date} />
          {state.mode === "move" ? (
            <>
              <input type="hidden" name="reservationId" value={state.reservationId} />
              <p className="text-[0.875rem] text-ink-2">
                Moving <span className="font-medium text-ink">{state.who}</span>. Pick a new
                space and time.
              </p>
            </>
          ) : null}

          {state.mode === "create" ? <CustomerPicker /> : null}

          <label className={LABEL}>
            <span>Space</span>
            <select name="spaceId" defaultValue={state.spaceId} className={FIELD}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              <span>Start</span>
              <input
                type="time"
                name="time"
                defaultValue={state.time}
                step={slot * 60}
                required
                className={FIELD}
              />
            </label>
            {state.mode === "create" ? (
              <label className={LABEL}>
                <span>Duration</span>
                <select name="slotCount" defaultValue="1" className={FIELD}>
                  {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {durationLabel(n * slot)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="flex items-end text-[0.8125rem] text-ink-3">
                Same length
              </div>
            )}
          </div>

          {state.mode === "create" ? (
            <>
              <label className={LABEL}>
                <span>Party size</span>
                <input
                  type="number"
                  name="partySize"
                  defaultValue={1}
                  min={1}
                  className={FIELD}
                />
              </label>
              <label className={LABEL}>
                <span>Note (optional)</span>
                <input name="notes" placeholder="Phone booking, walk-in…" className={FIELD} />
              </label>
            </>
          ) : null}

          {error ? (
            <p className="rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.8125rem] text-clay-ink">
              {error}
            </p>
          ) : null}

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-pill border border-rule px-4 py-2 text-[0.8125rem] text-ink-2 hover:border-rule-strong hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-pill bg-accent px-5 py-2 text-[0.8125rem] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
            >
              {pending ? "Saving…" : state.mode === "create" ? "Book" : "Move"}
            </button>
          </div>
        </form>

        {state.mode === "create" ? (
          <p className="px-5 pb-5 text-[0.75rem] text-ink-3">
            Books as confirmed (pay at venue). The price is set by the space and
            duration.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Search-or-add customer. Writes either `customerId` (existing) or
 * `name`/`email`/`phone` (new) as hidden fields the action reads.
 */
function CustomerPicker() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [selected, setSelected] = useState<CustomerHit | null>(null);
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (selected || adding) return;
    const q = query.trim();
    // All setHits calls live inside the debounced callback, never synchronously
    // in the effect body (which would cascade renders).
    const t = setTimeout(() => {
      if (q.length < 1) {
        setHits([]);
        return;
      }
      startTransition(async () => setHits(await searchCustomers(q)));
    }, 200);
    return () => clearTimeout(t);
  }, [query, selected, adding]);

  if (selected) {
    return (
      <div className={LABEL}>
        <span>Customer</span>
        <input type="hidden" name="customerId" value={selected.id} />
        <div className="flex items-center justify-between gap-2 rounded-sm border border-accent-line bg-accent-soft px-3 py-2">
          <span className="min-w-0 text-[0.875rem]">
            <span className="font-medium text-accent-ink">{selected.name}</span>
            <span className="block truncate text-[0.75rem] text-ink-3">{selected.email}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQuery("");
            }}
            className="text-[0.75rem] text-ink-3 underline hover:text-ink"
          >
            change
          </button>
        </div>
      </div>
    );
  }

  if (adding) {
    return (
      <div className="grid gap-3 rounded-sm border border-rule bg-paper-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[0.8125rem] font-medium">New customer</span>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="text-[0.75rem] text-ink-3 underline hover:text-ink"
          >
            search instead
          </button>
        </div>
        <label className={LABEL}>
          <span>Name</span>
          <input name="name" required defaultValue={query} className={FIELD} />
        </label>
        <label className={LABEL}>
          <span>Email</span>
          <input name="email" type="email" required placeholder="name@email.com" className={FIELD} />
        </label>
        <label className={LABEL}>
          <span>Phone (optional)</span>
          <input name="phone" placeholder="+63 917 000 0000" className={FIELD} />
        </label>
      </div>
    );
  }

  return (
    <div className={LABEL}>
      <span>Customer</span>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, email, phone"
        className={FIELD}
      />
      {query.trim().length >= 1 ? (
        <div className="overflow-hidden rounded-sm border border-rule">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setSelected(h)}
              className="flex w-full items-center justify-between gap-2 border-b border-rule px-3 py-2 text-left last:border-b-0 hover:bg-paper-2"
            >
              <span className="min-w-0 text-[0.875rem]">
                {h.name}
                <span className="block truncate text-[0.75rem] text-ink-3">{h.email}</span>
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full px-3 py-2 text-left text-[0.8125rem] text-accent-ink hover:bg-paper-2"
          >
            + Add “{query.trim()}” as a new customer
          </button>
        </div>
      ) : null}
    </div>
  );
}
