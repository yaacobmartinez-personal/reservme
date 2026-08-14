import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/marketing/wordmark";
import { currentVenue } from "@/lib/tenancy";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  if (await currentVenue()) redirect("/");

  // Marketing "Create your page" links carry ?new=1 so we open on the
  // create-venue tab rather than sign-in.
  const { new: isNew } = await searchParams;
  const startOnSignup = isNew !== undefined;

  return (
    <main className="flex flex-1 items-center justify-center py-16">
      <div className="shell max-w-md">
        <Wordmark className="text-lg" />
        <h1 className="mt-8 text-head">
          {startOnSignup ? "Create your venue" : "Run your venue"}
        </h1>
        <p className="mt-3 text-[0.9375rem] text-ink-2">
          Sign in to today&rsquo;s run sheet, or create a venue and take your first
          booking this afternoon.
        </p>

        <div className="mt-8 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          <LoginForm startOnSignup={startOnSignup} />
        </div>
      </div>
    </main>
  );
}
