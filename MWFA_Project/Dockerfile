# 1. الصورة الأساسية
FROM cyberillo/kali-mcp-server:latest

# 2. تثبيت بيئة Node.js
RUN apt-get update && apt-get install -y curl
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
RUN apt-get install -y nodejs

# 3. تحديد مجلد العمل الرئيسي
WORKDIR /app

# 4. نسخ كل محتويات المشروع (بما فيها مجلد backend)
COPY . .

# 5. الدخول لمجلد الباكند حصراً
WORKDIR /app/backend

# 6. تثبيت المكاتب (هنا package.json صار كدامه مباشرة)
RUN npm install

# 7. فتح بورت الباكند
EXPOSE 3000

# 8. تشغيل السيرفر
CMD ["node", "server.js"]
