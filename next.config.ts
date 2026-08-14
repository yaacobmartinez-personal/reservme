import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle so the production Docker image can ship
  // without node_modules. See Dockerfile.
  output: "standalone",
};

export default nextConfig;
