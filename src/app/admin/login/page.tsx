import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentPlatformAdmin } from "@/lib/admin/access";
import { AdminLoginForm } from "./admin-login-form";

export const metadata: Metadata = { title: "Platform sign in" };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await currentPlatformAdmin()) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center py-16">
      <div className="shell max-w-md">
        <h1 className="text-head">Platform console</h1>
        {/* Deliberately vague: this page must not reveal whether an account
            exists, nor whether it holds platform access. */}
        <p className="mt-3 text-[0.9375rem] text-ink-2">
          Restricted to ReservMe staff.
        </p>

        <div className="mt-8 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          <AdminLoginForm />
        </div>
      </div>
    </main>
  );
}
