FROM node:22-bookworm-slim

WORKDIR /app

# Slim dependency set — only the collaboration server's runtime deps, so the
# image never builds the desktop app's native modules.
COPY collaborations/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY collaborations/server.mjs ./server.mjs

ENV LATEXDO_COLLAB_HOST=0.0.0.0
ENV LATEXDO_COLLAB_PORT=8787
ENV LATEXDO_COLLAB_DATA_DIR=/data
# Behind a proxy by default (docker-compose publishes on 127.0.0.1).
ENV LATEXDO_COLLAB_TRUST_PROXY=true

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8787

CMD ["node", "server.mjs"]
