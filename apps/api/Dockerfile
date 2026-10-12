FROM node:22-bookworm AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY prisma prisma
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --network-concurrency=4 --fetch-timeout=120000
RUN pnpm prisma generate
COPY apps/api apps/api
RUN pnpm --filter @voidnas/api build
RUN NODE_ENV=test pnpm --filter @voidnas/api test

FROM node:22-bookworm AS runtime
RUN corepack enable && groupadd -g 10001 voidnas && useradd -r -u 10001 -g voidnas voidnas
WORKDIR /app
COPY --from=build --chown=voidnas:voidnas /app/node_modules ./node_modules
COPY --from=build --chown=voidnas:voidnas /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=voidnas:voidnas /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=voidnas:voidnas /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=voidnas:voidnas /app/prisma ./prisma
COPY --from=build --chown=voidnas:voidnas /app/package.json ./package.json
USER voidnas
EXPOSE 3000
CMD ["node","apps/api/dist/server.js"]
