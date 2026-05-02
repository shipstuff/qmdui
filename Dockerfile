FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.json ./
COPY scripts ./scripts
RUN npm ci

COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
  HOME=/data/home \
  XDG_CONFIG_HOME=/data/config \
  XDG_CACHE_HOME=/data/cache \
  QMDUI_HOST=0.0.0.0 \
  QMDUI_PORT=8765 \
  QMDUI_DATA_DIR=/data/qmdui

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init tar \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /tmp/qmdui \
  && chown -R node:node /data /tmp/qmdui

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 8765

CMD ["dumb-init", "node", "dist/server.js"]
