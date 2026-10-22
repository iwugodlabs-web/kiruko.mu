import type { NextConfig } from "next";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl wraps the build to inject the request-side locale resolver.
// The path here points at src/i18n/request.ts which reads the cookie +
// Accept-Language header on every request (no URL [locale] segment).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Don't advertise the framework/version to scanners.
  poweredByHeader: false,
  typescript: {
    // Type errors now fail the build — the codebase is tsc-clean (0 errors).
    ignoreBuildErrors: false,
  },
  eslint: {
    // Still ignored: ~13 lint errors (mostly unescaped JSX entities) + 425
    // warnings to clean up before enforcing. Tracked as a follow-up.
    ignoreDuringBuilds: true,
  },
  // API proxy is now handled by the Route Handler at src/app/api/v1/[...path]/route.ts
  // which reads BACKEND_URL at runtime (unlike rewrites which are resolved at build time).

  // Baseline security headers for every response (pages, static assets, and the
  // /api/v1 proxy). Deliberately does NOT restrict script/style sources — Next
  // injects inline bootstrap scripts — but locks down framing, MIME sniffing,
  // referrers, and plugin embedding, which is where the cheap wins are.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
