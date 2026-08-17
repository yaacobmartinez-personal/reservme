"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  addCustomerNote,
  addCustomerTag,
  updateCustomerContact,
} from "@/app/app/customer-actions";

/** Submit button that reflects the form's pending state. */
function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}

const PILL =
  "rounded-pill px-4 py-2 text-[0.8125rem] font-medium transition-colors duration-[--dur-fast] ease-out disabled:opacity-45";

/* ── Notes ────────────────────────────────────────────────────── */

export function AddNoteForm({ customerId }: { customerId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={async (fd) => {
        await addCustomerNote(fd);
        ref.current?.reset();
      }}
      className="mt-3"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <textarea
        name="body"
        required
        rows={2}
        maxLength={2000}
        placeholder="Add a note — a preference, a heads-up, a follow-up…"
        className="w-full resize-y rounded-sm border border-rule bg-paper-2 px-3 py-2 text-[0.875rem]"
      />
      <div className="mt-2 flex justify-end">
        <SubmitButton pendingLabel="Adding…" className={`${PILL} bg-ink text-paper hover:opacity-90`}>
          Add note
        </SubmitButton>
      </div>
    </form>
  );
}

/* ── Tags ─────────────────────────────────────────────────────── */

export function AddTagForm({ customerId }: { customerId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-pill border border-dashed border-rule-strong px-3 py-1 text-[0.75rem] text-ink-3 transition-colors duration-[--dur-fast] ease-out hover:border-ink hover:text-ink"
      >
        + tag
      </button>
    );
  }

  return (
    <form
      ref={ref}
      action={async (fd) => {
        await addCustomerTag(fd);
        ref.current?.reset();
        setOpen(false);
      }}
      className="inline-flex items-center gap-1"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <input
        name="tag"
        required
        autoFocus
        maxLength={30}
        placeholder="e.g. VIP"
        onBlur={(e) => {
          if (!e.currentTarget.value) setOpen(false);
        }}
        className="h-7 w-24 rounded-pill border border-rule bg-paper-2 px-3 text-[0.75rem]"
      />
      <SubmitButton
        pendingLabel="…"
        className="rounded-pill bg-ink px-2.5 py-1 text-[0.75rem] text-paper disabled:opacity-45"
      >
        Add
      </SubmitButton>
    </form>
  );
}

/* ── Contact (name / phone — email is read-only in v1) ────────── */

export function ContactEditor({
  customerId,
  name,
  email,
  phone,
}: {
  customerId: string;
  name: string;
  email: string;
  phone: string | null;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-medium tracking-[-0.01em]">{name}</h1>
          <p className="mt-1 truncate text-[0.9375rem] text-ink-2">
            {email}
            {phone ? <span className="text-ink-3"> · {phone}</span> : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 rounded-pill border border-rule-strong px-3.5 py-1.5 text-[0.8125rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:border-ink hover:text-ink"
        >
          Edit
        </button>
      </div>
    );
  }

  const field = "h-10 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";

  return (
    <form
      action={async (fd) => {
        await updateCustomerContact(fd);
        setEditing(false);
      }}
      className="grid gap-3"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <label className="grid gap-1 text-[0.8125rem] text-ink-2">
        <span>Name</span>
        <input name="name" required defaultValue={name} maxLength={120} className={field} />
      </label>
      <label className="grid gap-1 text-[0.8125rem] text-ink-2">
        <span>Phone</span>
        <input
          name="phone"
          defaultValue={phone ?? ""}
          maxLength={40}
          placeholder="+63 917 000 0000"
          className={field}
        />
      </label>
      <label className="grid gap-1 text-[0.8125rem] text-ink-3">
        <span>Email (can’t be changed)</span>
        <input value={email} disabled className={`${field} opacity-60`} />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className={`${PILL} border border-rule text-ink-2 hover:border-rule-strong hover:text-ink`}
        >
          Cancel
        </button>
        <SubmitButton pendingLabel="Saving…" className={`${PILL} bg-ink text-paper hover:opacity-90`}>
          Save
        </SubmitButton>
      </div>
    </form>
  );
}
