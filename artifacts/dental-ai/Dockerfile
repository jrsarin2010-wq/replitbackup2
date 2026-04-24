FROM node:20-alpine AS base
RUN npm install -g pnpm@9

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY lib/api-spec/package.json ./lib/api-spec/
COPY artifacts/dental-ai/package.json ./artifacts/dental-ai/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG VITE_API_URL=http://localhost:8080
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @workspace/dental-ai run build

FROM nginx:alpine AS runner
COPY --from=builder /app/artifacts/dental-ai/dist /usr/share/nginx/html
COPY artifacts/dental-ai/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
