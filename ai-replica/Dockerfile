# syntax=docker/dockerfile:1

# Multi-stage so the shipped image carries no compiler, no dev dependencies,
# and no TypeScript source — just Node, the runtime deps, and dist/.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Init process so SIGTERM reaches Node and the graceful shutdown path runs.
RUN apk add --no-cache tini

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node public ./public
COPY --chown=node:node persona ./persona

# Generated clips are written at runtime, so the directory must be owned by the
# unprivileged user the container runs as.
RUN mkdir -p public/generated && chown -R node:node public/generated

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
