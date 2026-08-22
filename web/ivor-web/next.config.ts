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
};

export default withNextIntl(nextConfig);
