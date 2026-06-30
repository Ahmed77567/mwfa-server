# ─────────────────────────────────────────────────────
# MWFA Dockerfile (Cloud Hub)
# Pure Node.js environment for SQLite & MQTT Logging
# ─────────────────────────────────────────────────────

FROM node:18-alpine

WORKDIR /app

# Copy package files first for caching
COPY backend/package*.json ./backend/

# Install backend deps
WORKDIR /app/backend
RUN npm install --production

# Copy all project files
WORKDIR /app
COPY . .

# Generate Prisma client
WORKDIR /app/backend
RUN npx prisma generate

EXPOSE 3000

# Run DB push and start Node.js backend
CMD ["sh", "-c", "mkdir -p /data && npx prisma db push --skip-generate && exec node server.js"]
