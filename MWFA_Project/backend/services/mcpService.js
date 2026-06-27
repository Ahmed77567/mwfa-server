'use strict';

/**
 * MWFA — Kali-MCP Bridge Service
 * ─────────────────────────────────────────────────────────────────────────────
 * يتواصل مع خادم Kali-MCP عبر بروتوكول JSON-RPC 2.0
 * الأداة الرئيسية: nmap  (tool name: "nmap")
 * المعاملات:       { target: string, flags: string }
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Kali-MCP always runs in the same container via supergateway on port 8000
// Force localhost regardless of any external MCP_URL env var
const MCP_URL     = 'http://localhost:8000';
const MCP_TIMEOUT = parseInt(process.env.MCP_TIMEOUT || '120000', 10);

console.log(`[MCP] Using MCP_URL: ${MCP_URL}`);

// ─────────────────────────────────────────────────────────────────────────────
// خرائط أنواع الفحص
// ─────────────────────────────────────────────────────────────────────────────

/**
 * كل profile يُرجع كائناً يحتوي على:
 *   - flags      : وسوم nmap الحقيقية
 *   - label      : اسم يُحفظ في قاعدة البيانات
 *   - description: وصف للـ logs
 */
const SCAN_PROFILES = {
  // سريع — أشهر 100 بورت
  fast: {
    flags:       '-F -T4 --open',
    label:       'nmap_fast',
    description: 'Fast Scan (Top 100 ports)',
  },
  // أشهر 1000 بورت مع كشف الإصدارات
  default: {
    flags:       '-sV -T4 --top-ports 1000 --open',
    label:       'nmap_default',
    description: 'Default Scan (Top 1000 + Version Detection)',
  },
  // كشف نظام التشغيل والخدمات
  os: {
    flags:       '-O -sV -T4 --top-ports 1000 --open',
    label:       'nmap_os',
    description: 'OS & Service Detection',
  },
  // فحص الثغرات عبر سكريبتات NSE
  vuln: {
    flags:       '-sV -T4 --top-ports 1000 --script=vuln --open',
    label:       'nmap_vuln',
    description: 'Vulnerability Scan (NSE scripts)',
  },
  // فحص شامل كل البورتات (بطيء)
  full: {
    flags:       '-sV -T4 -p- --open',
    label:       'nmap_full',
    description: 'Full Port Scan (All 65535 ports)',
  },
  // فحص UDP شائع
  udp: {
    flags:       '-sU -T4 --top-ports 100 --open',
    label:       'nmap_udp',
    description: 'UDP Scan (Top 100 UDP ports)',
  },
  // فحص aggresive كامل (بطيء جداً)
  aggressive: {
    flags:       '-A -T4 --open',
    label:       'nmap_aggressive',
    description: 'Aggressive Scan (-A: OS, Version, Scripts, Traceroute)',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC Helper
// ─────────────────────────────────────────────────────────────────────────────

async function mcpRequest(method, params = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT);

  try {
    const res = await fetch(`${MCP_URL}/message`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'no body');
      throw new Error(`MCP HTTP ${res.status}: ${text}`);
    }

    const json = await res.json();

    if (json.error) {
      throw new Error(`MCP RPC Error [${json.error.code}]: ${json.error.message}`);
    }

    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// أدوات MCP
// ─────────────────────────────────────────────────────────────────────────────

async function listTools() {
  try {
    const result = await mcpRequest('tools/list');
    return result?.tools ?? [];
  } catch (err) {
    console.error('[MCP] listTools failed:', err.message);
    return [];
  }
}

/**
 * تشغيل أداة MCP
 * @param {string} toolName   - اسم الأداة (مثل "nmap")
 * @param {object} args       - { target, flags }
 * @returns {Promise<string>} - النص الخام من المخرجات
 */
async function runTool(toolName, args = {}) {
  console.log(`[MCP] 🔧 ${toolName}`, args);

  const result = await mcpRequest('tools/call', {
    name:      toolName,
    arguments: args,
  });

  // المخرجات ترجع كمصفوفة content[{type:"text", text:"..."}]
  if (result?.content && Array.isArray(result.content)) {
    return result.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
  }

  // fallback لو جه نص مباشر
  if (typeof result === 'string') return result;

  return JSON.stringify(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser — استخراج البورتات من مخرجات nmap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يستخرج قائمة مثل ["22/tcp", "80/tcp", "443/tcp"] من نص nmap
 */
function extractPorts(nmapOutput) {
  const ports = [];
  // يطابق: "22/tcp   open  ssh"
  const regex = /^(\d+)\/(tcp|udp)\s+open/gm;
  let match;
  while ((match = regex.exec(nmapOutput)) !== null) {
    ports.push(`${match[1]}/${match[2]}`);
  }
  return ports;
}

// ─────────────────────────────────────────────────────────────────────────────
// دالة الفحص الأساسية المشتركة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يبني أوامر nmap بناءً على الـ profile والـ ports المخصصة،
 * ينفذ الفحص عبر MCP، ويحدث قاعدة البيانات.
 *
 * @param {object} device       - كائن Device من Prisma
 * @param {string} target       - IP أو دومين الهدف
 * @param {object} options
 * @param {string} [options.scanProfile='default'] - اسم الـ profile
 * @param {string} [options.ports='']              - بورتات مخصصة مثل "80,443" أو "1-1000"
 */
async function _executeScan(device, target, options = {}) {
  const profileKey = options.scanProfile && SCAN_PROFILES[options.scanProfile]
    ? options.scanProfile
    : 'default';

  const profile = SCAN_PROFILES[profileKey];

  // إذا وفّر المستخدم بورتات مخصصة → تحل محل أوامر الـ profile
  let finalFlags = profile.flags;
  if (options.ports && String(options.ports).trim().length > 0) {
    // نزيل أي -F أو --top-ports أو -p- موجودة في الـ flags الأصلية
    finalFlags = finalFlags
      .replace(/-F\s*/g, '')
      .replace(/--top-ports\s+\d+\s*/g, '')
      .replace(/-p-\s*/g, '')
      .trim();
    finalFlags = `-p ${String(options.ports).trim()} ${finalFlags}`;
  }

  console.log(`[MCP] 🚀 Starting ${profile.description} on ${target}`);
  console.log(`[MCP]    Flags: ${finalFlags}`);

  // إنشاء سجل الفحص
  const scanRecord = await prisma.scanResult.create({
    data: {
      deviceId:    device.id,
      scanType:    profile.label,
      status:      'running',
      mcpToolUsed: 'nmap',
    },
  });

  try {
    const nmapOutput = await runTool('nmap', {
      target: target,
      flags:  finalFlags,
    });

    const openPorts = extractPorts(nmapOutput);
    const portJson  = JSON.stringify(openPorts);

    console.log(`[MCP] ✅ ${profile.description} done — ${target} | Ports: ${portJson}`);

    await prisma.scanResult.update({
      where: { id: scanRecord.id },
      data: {
        openPorts: portJson,
        rawOutput: nmapOutput.slice(0, 10000), // max 10KB
        status:    'done',
      },
    });

    return { openPorts, nmapOutput, scanRecord };

  } catch (err) {
    console.error(`[MCP] ❌ Scan failed — ${target}:`, err.message);

    await prisma.scanResult.update({
      where: { id: scanRecord.id },
      data: {
        status:    'failed',
        rawOutput: err.message.slice(0, 2000),
      },
    });

    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// الدوال المصدّرة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * فحص جهاز محلي (يُستدعى من MQTT أو من زر "Scan IP" بالواجهة)
 */
async function scanTarget(device, ipAddress, options = {}) {
  return _executeScan(device, ipAddress, {
    scanProfile: options.scanProfile || 'default',
    ports:       options.ports || '',
  });
}

/**
 * فحص هدف مخصص عام — دومين أو IP خارجي
 */
async function scanCustomTarget(target, options = {}) {
  // إنشاء / تحديث "جهاز وهمي" لربط النتائج به
  const dummyMac = `CUSTOM-${target.replace(/[^a-zA-Z0-9]/g, '').substring(0, 12)}`;

  const device = await prisma.device.upsert({
    where:  { macAddress: dummyMac },
    update: { ipAddress: target, lastSeen: new Date() },
    create: {
      macAddress: dummyMac,
      ipAddress:  target,
      hostname:   target,
      status:     'up',
      vendor:     'Cloud Custom Target',
    },
  });

  return _executeScan(device, target, options);
}

/**
 * فحص ثغرات لبورت محدد
 */
async function scanVulnerabilities(ipAddress, port, device) {
  const target = ipAddress;
  const opts   = { scanProfile: 'vuln', ports: String(port) };

  if (device) {
    return _executeScan(device, target, opts);
  }

  // إذا لم يُعطَ جهاز → نستخدم custom target
  return scanCustomTarget(target, opts);
}

/**
 * فحص صحة الاتصال بـ Kali-MCP — يُظهر الأدوات المتاحة وعددها
 */
async function healthCheck() {
  try {
    const tools = await listTools();
    return {
      status:      'ok',
      mcpUrl:      MCP_URL,
      toolsCount:  tools.length,
      tools:       tools.map(t => t.name),
      profiles:    Object.keys(SCAN_PROFILES),
    };
  } catch (err) {
    return {
      status:  'unreachable',
      mcpUrl:  MCP_URL,
      error:   err.message,
    };
  }
}

module.exports = {
  runTool,
  listTools,
  scanTarget,
  scanCustomTarget,
  scanVulnerabilities,
  healthCheck,
  SCAN_PROFILES,
};
