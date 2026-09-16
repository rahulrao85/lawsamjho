import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted on the VPS as a Docker container behind Caddy, not Vercel —
  // standalone bundles only the files `node server.js` needs into `.next/standalone`.
  output: "standalone",
  /**
   * This app lives inside a larger repo that has its own package-lock.json, so
   * Turbopack's root autodetection picks the parent directory (and would then
   * watch the whole umbrella tree). Pin it to this project instead.
   * `next dev` / `next build` always run from the project directory, so
   * process.cwd() is the correct absolute path without needing __dirname.
   */
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
