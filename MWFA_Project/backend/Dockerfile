################################################################
# MWFA Combined Container
# Kali-MCP (security tools) + Node.js Backend in one image
# الفكرة: كالي-MCP يشتغل على المنفذ 8000 داخلياً
#         باكند Node.js يشتغل على المنفذ 3001 للخارج
################################################################

# ── Base: كالي-MCP اللي بيها كل أدوات الأمان ─────────────────
FROM cyberillo/kali-mcp-server:latest

# ── تثبيت Node.js 20 LTS + supervisor (لتشغيل برنامجين) ──────
RUN apt-get update && apt-get install -y \
    curl \
    supervisor \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── نسخ وتثبيت تبعيات الباكند ────────────────────────────────
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# ── توليد Prisma Client ───────────────────────────────────────
COPY prisma ./prisma/
RUN npx prisma generate

# ── نسخ باقي الكود ───────────────────────────────────────────
COPY . .

# ── Supervisor Config (يشغّل كالي + نود بنفس الوقت) ──────────
COPY supervisord.conf /etc/supervisor/conf.d/mwfa.conf

# ── المنفذ المكشوف للخارج (Railway) ──────────────────────────
EXPOSE 3001

# ── تشغيل الاثنين عبر supervisor ─────────────────────────────
CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]
