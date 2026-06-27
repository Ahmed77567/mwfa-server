# ─────────────────────────────────────────────────────
# MWFA Dockerfile
# بناء صورة واحدة تشغّل Kali-MCP + Node.js Backend
# ─────────────────────────────────────────────────────

# 1. الصورة الأساسية — تحتوي على Python + Kali + kali-mcp
FROM cyberillo/kali-mcp-server:latest

# 2. تثبيت Node.js 18
RUN apt-get update && apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# 3. تحديد مجلد العمل الرئيسي
WORKDIR /app

# 4. نسخ المشروع بالكامل
COPY . .

# 5. تثبيت مكتبات Node.js للـ backend
WORKDIR /app/backend
RUN npm install --production && \
    npx prisma generate

# 6. نسخ startup script وجعله قابل للتنفيذ
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# 7. فتح بورت الـ backend
EXPOSE 3000

# 8. تشغيل كلا السيرفرين عبر startup script
CMD ["/app/start.sh"]
