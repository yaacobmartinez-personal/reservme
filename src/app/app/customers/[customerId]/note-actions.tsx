"use client";

import { deleteCustomerNote } from "@/app/app/customer-actions";

/** A quiet "Delete" that only shows on hover/focus of the note card. */
export function DeleteNoteButton({
  noteId,
  customerId,
}: {
  noteId: string;
  customerId: string;
}) {
  return (
    <form action={deleteCustomerNote}>
      <input type="hidden" name="noteId" value={noteId} />
      <input type="hidden" name="customerId" value={customerId} />
      <button
        type="submit"
        className="text-ink-3 opacity-0 transition-opacity duration-[--dur-fast] ease-out hover:text-clay-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        Delete
      </button>
    </form>
  );
}
