##
## @file Dockerfile
## @description Production Dockerfile for the LaunchMind Fastify API.
##   Multi-stage build. Non-root user. Health check on /health.
##   Used by: local dev (docker-compose), CI/CD integration tests.
##   NOT used for production deployment — Oracle VM uses oracle-deploy.sh instead.
##

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# legacy-peer-deps: resend v3 has optional React peer deps not needed in backend
RUN npm ci --omit=dev --legacy-peer-deps

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
RUN addgroup -g 1001 -S nodejs && adduser -S launchmind -u 1001 -G nodejs
USER launchmind
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "dist/server.js"]
