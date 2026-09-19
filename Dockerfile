# Matches this box's existing container pattern: internal port 8080,
# Caddy reverse-proxies the public subdomain to a host port mapped to it.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Real values aren't needed to build -- getServerEnv() is called lazily at
# request time, never at build time (see src/lib/env.ts).
ENV GEMINI_API_KEY=build-placeholder
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
# No public/ directory in this repo -- nothing references a public asset, and
# public/ is empty, which means untracked: git cannot track an empty
# directory, so a fresh clone (what any real build starts from) has no
# public/ at all. Copying from it here failed on exactly that clone, even
# though it built fine from this working copy's own leftover empty folder.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 8080
CMD ["node", "server.js"]
