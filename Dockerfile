FROM node:20-slim
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/sales-assistant run build
RUN pnpm --filter @workspace/api-server run build
EXPOSE 8080
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
