# ---------- 阶段 1：构建前端 ----------
FROM node:22-alpine AS web-builder
WORKDIR /build/web
COPY web/package.json ./
RUN npm install --registry=https://registry.npmmirror.com
COPY web/ ./
RUN npm run build

# ---------- 阶段 2：后端运行环境 ----------
# node:sqlite 为 Node 22 内置模块，无需原生编译依赖
FROM node:22-slim AS runner
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --registry=https://registry.npmmirror.com

COPY server/ ./server/
COPY --from=web-builder /build/web/dist ./web/dist

ENV PORT=3000
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "--no-warnings", "server/index.js"]
