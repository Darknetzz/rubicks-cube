FROM node:26.13.1-alpine
ENV NODE_ENV=production PORT=3000 STATIC_DIR=/app DATA_FILE=/data/state.json
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev && npm cache clean --force
COPY package.json index.html style.css ./
COPY js js
COPY server/src server/src
COPY server/vendor server/vendor
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/src/index.js"]
