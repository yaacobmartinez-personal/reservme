import { z } from "zod";
import { auth } from "@/lib/auth";
import { fromAuthError, invalid, ok } from "@/lib/mobile/respond";
import { userJson } from "@/lib/mobile/session";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

/**
 * POST /api/mobile/auth/login — API-CONTRACT #10.
 *
 * `{email, password}` → `{token, user}`.
 *
 * The token is Better Auth's own session token, lifted out of the
 * `set-auth-token` header the bearer plugin writes. `asResponse: true` is what
 * makes that header reachable: the plain call returns the parsed body and
 * throws the headers away with it.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return invalid({ email: "Enter your email and password." }, "Enter your email and password.");
  }

  try {
    const response = await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: request.headers,
      asResponse: true,
    });

    const token = response.headers.get("set-auth-token");
    const body = (await response.json()) as { user?: Record<string, unknown> };

    if (!response.ok || !token || !body.user) {
      // Deliberately one message for a wrong password and an address with no
      // account: the login screen must not become a way to ask whether an
      // email is registered here.
      return fromAuthError(
        { statusCode: response.status },
        "That email and password don't match.",
      );
    }

    const user = body.user as { id: string; email: string; name?: string | null; emailVerified?: boolean };
    return ok({
      token,
      user: userJson({
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        emailVerified: Boolean(user.emailVerified),
      }),
    });
  } catch (error) {
    return fromAuthError(error, "That email and password don't match.");
  }
}
