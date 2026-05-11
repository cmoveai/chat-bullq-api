# syntax=docker/dockerfile:1.6

FROM node:22-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=development
COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile --production=false --network-timeout 600000

FROM node:22-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN yarn build

FROM node:22-alpine AS runner
# postgresql-client pra pg_dump rodar dentro do container (BackupService)
RUN apk add --no-cache openssl curl tini postgresql16-client
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile --production=true --network-timeout 600000 && yarn cache clean

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

RUN mkdir -p /app/uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/v1 | grep -qE "^(2|3|4)" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
