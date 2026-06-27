# ─────────────────────────────────────────────────────
# MWFA Dockerfile
# Kali-MCP (stdio) → supergateway (HTTP:8000) + Node.js Backend
# ─────────────────────────────────────────────────────

FROM cyberillo/kali-mcp-server:latest

# Install Node.js 18
RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install supergateway globally (bridges stdio MCP → HTTP/SSE)
RUN npm install -g supergateway

WORKDIR /app
COPY . .

# Install backend deps
WORKDIR /app/backend
RUN npm install --production && npx prisma generate

EXPOSE 3000

# Run DB push and start Node.js backend
CMD ["sh", "-c", "mkdir -p /data && npx prisma db push --skip-generate && exec node server.js"]

