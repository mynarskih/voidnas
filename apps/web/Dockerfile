FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --network-concurrency=4 --fetch-timeout=120000
COPY apps/web apps/web
RUN pnpm --filter @voidnas/web build
RUN pnpm --filter @voidnas/web test

FROM caddy:2.10-alpine
COPY --from=build /app/apps/web/dist /srv
COPY infra/caddy/Web.Caddyfile /etc/caddy/Caddyfile
