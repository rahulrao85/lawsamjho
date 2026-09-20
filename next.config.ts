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

  /**
   * Baseline security headers. Confirmed missing on the live deployment
   * (checked with `curl -I` directly) before adding these -- the Caddy layer
   * in front of this app sets them on the apex domain's static-file block but
   * never on this app's own subdomain, so nothing downstream of Next.js could
   * be relied on to add them. Set here instead of in Caddy: this way they
   * hold regardless of what's in front of the app, and they're a property of
   * the code a reviewer reads, not of infrastructure a reviewer doesn't see.
   *
   * The one compromise: script-src needs 'unsafe-inline' for the pre-paint
   * theme script in layout.tsx (THEME_INIT_SCRIPT) -- it must run before any
   * external file could load, so it cannot be an external script, and this
   * app has no nonce-per-request plumbing to allow it more narrowly. The
   * script is a small, static, developer-authored string, not user input, so
   * the practical XSS surface this reopens is limited to that one string --
   * worth naming rather than glossing over.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
