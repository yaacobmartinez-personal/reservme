# Multi-stage build → a small standalone image that runs either the web server
# or the background worker, chosen by the container command.
#
#   Web:    (default CMD) node server.js
#   Worker: node worker.js
#
# Both share the same image and env.

# ── deps ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Public env is inlined at build time; hosts are overridden at deploy via the
# real values. Provide harmless defaults so the build doesn't fail on them.
ENV NEXT_PUBLIC_APEX_HOST=reservme.pro \
    NEXT_PUBLIC_APP_HOST=app.reservme.pro \
    NEXT_PUBLIC_ADMIN_HOST=admin.reservme.pro \
    NEXT_PUBLIC_PROTOCOL=https
RUN npm run build
# Compile the worker + migrator to plain JS so the runtime image needs no tsx.
RUN npx esbuild scripts/worker.ts scripts/migrate.ts \
      --bundle --platform=node --format=cjs --outdir=dist \
      --external:pg-native

# ── runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S app && adduser -S app -G app

# Next standalone output: server.js + the minimal node_modules it traced.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Worker, migrator, and the raw SQL migrations they apply.
COPY --from=build /app/dist ./
COPY --from=build /app/drizzle ./drizzle

USER app
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

# Default: the web server. Override with `node worker.js` for the worker.
CMD ["node", "server.js"]
