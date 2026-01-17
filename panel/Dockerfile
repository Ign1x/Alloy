ARG ELEGANTMC_VERSION=dev
ARG ELEGANTMC_REVISION=unknown
ARG ELEGANTMC_BUILD_DATE=unknown

FROM node:20-bookworm-slim AS deps
WORKDIR /app
ARG NPM_REGISTRY
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

ARG ELEGANTMC_VERSION
ARG ELEGANTMC_REVISION
ARG ELEGANTMC_BUILD_DATE

ENV ELEGANTMC_VERSION=$ELEGANTMC_VERSION \
  ELEGANTMC_REVISION=$ELEGANTMC_REVISION \
  ELEGANTMC_BUILD_DATE=$ELEGANTMC_BUILD_DATE

LABEL org.opencontainers.image.title="ElegantMC Panel" \
  org.opencontainers.image.description="ElegantMC Panel (Next.js + custom Node server)" \
  org.opencontainers.image.version="$ELEGANTMC_VERSION" \
  org.opencontainers.image.revision="$ELEGANTMC_REVISION" \
  org.opencontainers.image.created="$ELEGANTMC_BUILD_DATE"

# Keep only what we need to run the custom Next.js server.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server ./server

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=2s --start-period=10s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:3000/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
