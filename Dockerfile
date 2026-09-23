# Claude Code Proxy Router image.
# config.json is not baked in: bind-mount it read-only at /app/config.json.
FROM node:24-alpine

ENV NODE_ENV=production \
    PROXY_HOST=0.0.0.0

WORKDIR /app

COPY package.json ./
COPY src ./src

USER node

EXPOSE 3456

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3456/admin/status').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "src/index.js"]
