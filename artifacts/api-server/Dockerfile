FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++ \
 && npm install -g pnpm@10.26.1

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY lib/integrations-openai-ai-react/package.json ./lib/integrations-openai-ai-react/
COPY lib/integrations-openai-ai-server/package.json ./lib/integrations-openai-ai-server/
COPY scripts/package.json ./scripts/
RUN pnpm install --frozen-lockfile \
    --filter "@workspace/api-server..." \
    --filter "@workspace/api-server^..."

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server
ENV DATABASE_URL="postgres://build:build@localhost:5432/build" \
    AI_INTEGRATIONS_OPENAI_BASE_URL="https://placeholder.invalid" \
    AI_INTEGRATIONS_OPENAI_API_KEY="placeholder" \
    SESSION_SECRET="build-time-placeholder" \
    JWT_SECRET="build-time-placeholder"
RUN pnpm --filter @workspace/api-server run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/artifacts/api-server/dist ./dist
COPY --from=builder /app/artifacts/api-server/package.json ./package.json
EXPOSE 8080
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
