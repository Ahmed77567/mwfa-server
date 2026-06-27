# 1. الصورة الأساسية
FROM cyberillo/kali-mcp-server:latest

# 2. تثبيت بيئة Node.js
RUN apt-get update && apt-get install -y curl
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
RUN apt-get install -y nodejs

# 3. تحديد مجلد العمل داخل الحاوية
WORKDIR /app

# 4. نسخ ملفات التعريف حصراً من مجلد الباكند
COPY backend/package*.json ./

# 5. التثبيت المرن
RUN npm install

# 6. نسخ باقي ملفات الباكند (مثل server.js)
COPY backend/ ./

# 7. فتح بورت الباكند
EXPOSE 3000

# 8. تشغيل الباكند
CMD ["node", "server.js"]