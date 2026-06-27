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

# Find the kali-mcp entrypoint and start everything
# supergateway wraps the stdio-based kali-mcp as an HTTP server on port 8000
# then node server.js starts the backend on port 3000
CMD ["sh", "-c", "\
  mkdir -p /data && \
  npx prisma db push --skip-generate && \
  echo '[STARTUP] Finding kali-mcp entrypoint...' && \
  KALI_CMD=$(which kali-mcp 2>/dev/null || echo '') && \
  if [ -z \"$KALI_CMD\" ]; then \
    KALI_CMD=$(find / -name 'main.py' -path '*kali*' 2>/dev/null | head -1); \
    if [ -n \"$KALI_CMD\" ]; then KALI_CMD=\"python3 $KALI_CMD\"; fi; \
  fi && \
  if [ -z \"$KALI_CMD\" ]; then \
    KALI_CMD=$(find / -name 'server.py' -path '*kali*' 2>/dev/null | head -1); \
    if [ -n \"$KALI_CMD\" ]; then KALI_CMD=\"python3 $KALI_CMD\"; fi; \
  fi && \
  if [ -z \"$KALI_CMD\" ]; then \
    ENTRY=$(cat /proc/1/cmdline 2>/dev/null | tr '\\0' ' ' || echo ''); \
    echo \"[STARTUP] Could not find kali-mcp. Container default: $ENTRY\"; \
    KALI_CMD='python3 -m kali_mcp'; \
  fi && \
  echo \"[STARTUP] Kali-MCP command: $KALI_CMD\" && \
  echo \"[STARTUP] Starting supergateway on port 8000...\" && \
  supergateway --stdio \"$KALI_CMD\" --port 8000 & \
  sleep 4 && \
  echo '[STARTUP] Starting Node.js backend...' && \
  exec node server.js \
"]
