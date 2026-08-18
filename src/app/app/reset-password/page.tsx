import type { Metadata } from "next";
import { Suspense } from "react";
import { Wordmark } from "@/components/marketing/wordmark";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center py-16">
      <div className="shell max-w-md">
        <Wordmark className="text-lg" />
        <h1 className="mt-8 text-head">Choose a new password</h1>
        <div className="mt-8 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          {/* useSearchParams needs a Suspense boundary. */}
          <Suspense fallback={<p className="text-[0.9375rem] text-ink-3">Loading…</p>}>
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
