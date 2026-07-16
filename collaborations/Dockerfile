FROM node:22.17.0-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY collaborations ./collaborations

ENV LATEXDO_COLLAB_HOST=0.0.0.0
ENV LATEXDO_COLLAB_PORT=8787
ENV LATEXDO_COLLAB_DATA_DIR=/data

EXPOSE 8787

CMD ["node", "collaborations/server.mjs"]
