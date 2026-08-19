"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { updateReviewUrl, type ReviewFormState } from "./actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function ReviewLinkForm({ reviewUrl }: { reviewUrl: string | null }) {
  const [state, formAction] = useActionState<ReviewFormState, FormData>(updateReviewUrl, {
    status: "idle",
  });

  return (
    <form action={formAction} className="rounded-xl border border-rule bg-card p-5 shadow-plate">
      <h2 className="font-medium">Review link</h2>
      <p className="mt-1 text-[0.875rem] text-ink-3">
        Paste your Google (or other) review link. A couple of hours after a booking
        ends, we email the customer inviting them to leave a review.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="grid flex-1 gap-1.5">
          <span className="text-[0.875rem] text-ink-2">Review URL</span>
          <input
            name="reviewUrl"
            type="url"
            defaultValue={reviewUrl ?? ""}
            placeholder="https://g.page/r/…/review"
            className="h-11 rounded-sm border border-rule bg-paper px-3 text-[0.9375rem]"
          />
        </label>
        <SaveButton />
      </div>

      {state.status === "error" ? (
        <p
          role="alert"
          className="mt-3 rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.875rem] text-clay-ink"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === "saved" ? (
        <p
          role="status"
          className="mt-3 rounded-sm border border-accent-line bg-accent-soft px-3 py-2 text-[0.875rem] text-accent-ink"
        >
          Saved.
        </p>
      ) : null}
    </form>
  );
}
