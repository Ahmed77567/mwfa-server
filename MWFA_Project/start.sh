#!/bin/sh
# ─────────────────────────────────────────────────────
# MWFA Startup Script
# يشغل Kali-MCP Python Server + Node.js Backend معاً
# ─────────────────────────────────────────────────────

set -e

echo "🔧 [STARTUP] Creating data directory..."
mkdir -p /data

echo "🔧 [STARTUP] Running Prisma DB push..."
cd /app/backend
npx prisma db push --skip-generate

echo "🚀 [STARTUP] Starting Kali-MCP Python server on port 8000..."
# nohup حتى لا يوقف المتابعة
cd /app/mcp || cd /kali-mcp || cd /usr/local/lib/python3*/dist-packages/kali_mcp || true
# جرب إيجاد ملف main.py أو server.py أو الأمر المباشر
if command -v kali-mcp &> /dev/null; then
  nohup kali-mcp --host 0.0.0.0 --port 8000 &
elif [ -f /app/mcp/main.py ]; then
  nohup python3 /app/mcp/main.py &
elif [ -f /kali-mcp/main.py ]; then
  nohup python3 /kali-mcp/main.py &
else
  # البحث في كل مكان
  MAIN=$(find / -name "main.py" -path "*/kali*" 2>/dev/null | head -1)
  if [ -n "$MAIN" ]; then
    echo "Found kali-mcp at: $MAIN"
    nohup python3 "$MAIN" &
  else
    echo "⚠️  Could not find kali-mcp — trying uvicorn fallback..."
    nohup python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 &
  fi
fi

MCP_PID=$!
echo "✅ [STARTUP] Kali-MCP PID: $MCP_PID"

echo "⏳ [STARTUP] Waiting 3s for MCP to initialize..."
sleep 3

echo "🚀 [STARTUP] Starting Node.js backend..."
cd /app/backend
exec node server.js
