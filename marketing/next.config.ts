import type { NextConfig } from "next";

/**
 * Static export — the marketing site is fully static (no server, no database,
 * no auth). `next build` emits plain HTML/CSS/JS to `out/`, hostable anywhere:
 * Cloudflare Pages, Netlify, Vercel, S3+CloudFront, GitHub Pages.
 *
 * The app (auth, dashboard, booking) is a separate deployment — see
 * NEXT_PUBLIC_APP_URL and the root project.
 */
const nextConfig: NextConfig = {
  output: "export",
  // No next/image is used; keep this so export never trips on optimization.
  images: { unoptimized: true },
  // Pin the root to THIS directory. The parent project also has a lockfile, and
  // without this Next infers the parent as the workspace root and tries to
  // compile the app's src/proxy.ts (and other root-only files) into this build.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
