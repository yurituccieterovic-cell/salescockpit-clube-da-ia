FROM node:20

RUN npm install -g pnpm@9.15.9

WORKDIR /app
COPY . .

RUN pnpm install --no-frozen-lockfile

RUN BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/sales-assistant run build
RUN pnpm --filter @workspace/api-server run build

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/api/healthz || exit 1

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
