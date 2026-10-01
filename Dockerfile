# Build the static site with Vite, then serve dist/ + the online relay (/ws) from one small Node server.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=80 DIST=/app/dist
WORKDIR /app
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
CMD ["node", "server/server.mjs"]
