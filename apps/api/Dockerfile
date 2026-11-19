# Klymon API production image. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t klymon-api .
# Coolify: point it at this Dockerfile (repo root context); set the env vars
# from apps/api/.env.example plus TRUST_PROXY=1 (Coolify terminates TLS).
FROM node:22-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @klymon/api...
RUN pnpm --filter @klymon/api prisma:generate
RUN pnpm --filter @klymon/api build
RUN pnpm --filter @klymon/api --prod deploy --legacy /prod/api
# The deploy output has a fresh prod node_modules: generate the Prisma client into it.
RUN pnpm --filter @klymon/api exec prisma generate --schema /prod/api/prisma/schema.prisma

FROM node:22-slim AS runner
RUN groupadd -g 1001 klymon && useradd -u 1001 -g klymon -m klymon
WORKDIR /prod/api
COPY --from=build --chown=1001:1001 /prod/api ./
RUN chmod +x ./docker-entrypoint.sh
ENV NODE_ENV=production PORT=3001
USER 1001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.PORT||'3001')+'/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["./docker-entrypoint.sh"]
