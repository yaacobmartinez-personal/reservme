import { redirect } from "next/navigation";
import { resolveImpersonation, setImpersonationCookie } from "@/lib/admin/impersonation";

export const dynamic = "force-dynamic";

/**
 * Impersonation hand-off, on the app host. The admin console starts a session
 * (DB row + token) and redirects here with the token; we re-validate it and set
 * the impersonation cookie on *this* host, so the admin then browses the
 * tenant's real dashboard. The cookie stays host-only on the app host — the
 * apex booking pages never carry it. An invalid/expired token just bounces home.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const impersonation = token ? await resolveImpersonation(token) : null;
  if (!impersonation) redirect("/login");

  await setImpersonationCookie(token);
  redirect("/");
}
