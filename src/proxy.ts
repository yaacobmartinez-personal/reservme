import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_HOST, APP_HOST } from "@/lib/env";

/**
 * Three hostnames, one Next app.
 *
 *   reservme.pro          → marketing, and every venue's public booking page
 *                           at /<venueSlug>
 *   app.reservme.pro      → auth and the owner dashboard
 *   admin.reservme.pro    → the platform console (cross-tenant)
 *
 * Each subdomain is rewritten onto an internal prefix so all three can live in
 * one route tree. The rewrite is invisible — the URL stays app.reservme.pro/…
 *
 * The prefixes are also blocked on every *other* host, so a routing slip can't
 * expose the admin console at reservme.pro/admin. That check is the reason the
 * whole scheme is safe; do not remove it when adding a fourth host.
 *
 * Locally these are app.localhost:3000 and admin.localhost:3000, which resolve
 * to 127.0.0.1 in every current browser without touching /etc/hosts.
 */
const PREFIXES = {
  app: "/app",
  admin: "/admin",
} as const;

const ALL_PREFIXES = Object.values(PREFIXES);

function isUnder(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const { pathname } = request.nextUrl;

  const isAppHost = host === APP_HOST.toLowerCase();
  const isAdminHost = host === ADMIN_HOST.toLowerCase();

  // Health check answers on every host, unrewritten — orchestrators hit the
  // container directly with whatever Host header they please.
  if (pathname === "/api/healthz") return NextResponse.next();

  // Auth endpoints are served unprefixed, and only on the signed-in surfaces.
  if (pathname.startsWith("/api/")) {
    return isAppHost || isAdminHost
      ? NextResponse.next()
      : new NextResponse("Not found", { status: 404 });
  }

  const target = isAdminHost ? PREFIXES.admin : isAppHost ? PREFIXES.app : null;

  if (target) {
    // Requesting the internal prefix directly on its own host would otherwise
    // double it (/admin → /admin/admin) and 404 confusingly.
    if (isUnder(pathname, target)) {
      return new NextResponse("Not found", { status: 404 });
    }
    const url = request.nextUrl.clone();
    url.pathname = `${target}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // Apex: no internal prefix is reachable.
  if (ALL_PREFIXES.some((prefix) => isUnder(pathname, prefix))) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
