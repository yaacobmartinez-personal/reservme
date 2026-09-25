import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

const handler = toNextJsHandler(auth);

/**
 * The bearer plugin exists for the mobile app, and its after-hook puts the
 * session token in a `set-auth-token` header on *every* response — including
 * the browser's, where it is also exposed through
 * `access-control-expose-headers`.
 *
 * On this surface that is a downgrade. The session cookie is deliberately
 * HttpOnly so page scripts cannot read it; handing the same value back in a
 * readable header gives that up for the one response that matters most.
 *
 * So it is stripped here, on the public /api/auth/* routes only. The mobile
 * routes call `auth.api.*` directly with `asResponse: true` and read the header
 * off that internal response, so they are untouched — see
 * src/app/api/mobile/auth/login/route.ts.
 */
function stripBearerHeaders(response: Response): Response {
  if (!response.headers.has("set-auth-token")) return response;

  const headers = new Headers(response.headers);
  headers.delete("set-auth-token");

  const exposed = headers
    .get("access-control-expose-headers")
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.toLowerCase() !== "set-auth-token");

  if (exposed?.length) {
    headers.set("access-control-expose-headers", exposed.join(", "));
  } else {
    headers.delete("access-control-expose-headers");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const GET = async (request: Request) => stripBearerHeaders(await handler.GET(request));
export const POST = async (request: Request) => stripBearerHeaders(await handler.POST(request));
