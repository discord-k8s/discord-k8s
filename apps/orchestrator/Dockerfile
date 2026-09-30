FROM node:24-slim AS base

WORKDIR /app

FROM base AS builder

COPY . .

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

RUN pnpm --filter="@discord-k8s/orchestrator-image..." install --frozen-lockfile
RUN pnpm --filter="@discord-k8s/orchestrator-image..." build 
RUN pnpm --prod deploy pruned --filter "@discord-k8s/orchestrator-image" --legacy

FROM base AS runner

COPY --from=builder /app/pruned .

ENV PORT=8080

CMD ["node", "--enable-source-maps", "./index.mjs"]