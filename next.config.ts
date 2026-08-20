import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle so the production Docker image can ship
  // without node_modules. See Dockerfile.
  output: "standalone",

  experimental: {
    // Images (logo, cover, court photo, QR) are sent to Server Actions as base64
    // data URLs, up to 2 MB each; branding submits logo + cover together. Base64
    // adds ~33%, so lift the 1 MB default to comfortably fit both.
    serverActions: { bodySizeLimit: "8mb" },
  },

  async headers() {
    return [
      {
        // The booking widget is meant to be embedded on any customer's site, so
        // explicitly allow framing from anywhere (overrides any future default
        // frame protection). The rest of the app has no such header.
        source: "/:venueSlug/embed",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ];
  },
};

export default nextConfig;
