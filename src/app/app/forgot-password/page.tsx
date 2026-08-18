import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/marketing/wordmark";
import { currentVenue } from "@/lib/tenancy";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  // A signed-in owner has no use for this page.
  if (await currentVenue()) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center py-16">
      <div className="shell max-w-md">
        <Wordmark className="text-lg" />
        <h1 className="mt-8 text-head">Reset your password</h1>
        <div className="mt-8 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          <ForgotForm />
        </div>
      </div>
    </main>
  );
}
