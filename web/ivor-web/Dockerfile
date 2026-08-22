FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app/web/ivor-web

# Build context is the repo root so that ../../shared/ imports resolve.
COPY web/ivor-web/package.json web/ivor-web/package-lock.json* ./
RUN npm install

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/web/ivor-web/node_modules ./web/ivor-web/node_modules
COPY web/ivor-web ./web/ivor-web
COPY shared ./shared

WORKDIR /app/web/ivor-web

# Bake NEXT_PUBLIC_* env vars at build time (Next.js inlines them into the bundle)
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Standalone output uses outputFileTracingRoot=/app, so it preserves the
# web/ivor-web/ subpath inside .next/standalone.
COPY --from=builder --chown=nextjs:nodejs /app/web/ivor-web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/ivor-web/.next/static ./web/ivor-web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/ivor-web/public ./web/ivor-web/public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "web/ivor-web/server.js"]
