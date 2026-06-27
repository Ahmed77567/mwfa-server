'use strict';

/**
 * MWFA — Kali-MCP Bridge Service
 * ─────────────────────────────────────────────────────────────────────────────
 * يتواصل مع خادم Kali-MCP الذي يعمل على المنفذ 8000.
 * يستخدم بروتوكول MCP (Model Context Protocol) لتنفيذ أدوات الأمان
 * مثل nmap, hydra, masscan, وغيرها عبر الذكاء الاصطناعي.
 *
 * التوثيق: https://github.com/binaryfire/kali-mcp
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const MCP_URL     = process.env.MCP_URL || 'http://localhost:8000';
const MCP_TIMEOUT = parseInt(process.env.MCP_TIMEOUT || '60000', 10); // 60 ثانية

// ─────────────────────────────────────────────────────────────────────────────
// MCP JSON-RPC Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يرسل طلب JSON-RPC 2.0 إلى Kali-MCP
 * @param {string} method  - اسم الـ MCP method (مثل "tools/call")
 * @param {object} params  - المعاملات
 * @returns {Promise<any>}
 */
async function mcpRequest(method, params = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT);

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id:      Date.now(),
    method,
    params,
  });

  try {
    const res = await fetch(`${MCP_URL}/mcp`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal:  controller.signal,
    });

    if (!res.ok) {
      throw new Error(`MCP HTTP ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();

    if (json.error) {
      throw new Error(`MCP Error ${json.error.code}: ${json.error.message}`);
    }

    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// قائمة الأدوات المتاحة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * جلب قائمة الأدوات المتاحة في Kali-MCP
 */
async function listTools() {
  try {
    const result = await mcpRequest('tools/list');
    return result?.tools || [];
  } catch (err) {
    console.error('[MCP] listTools failed:', err.message);
    return [];
  }
}

/**
 * تشغيل أداة معينة في Kali-MCP
 * @param {string} toolName - اسم الأداة (مثل "nmap", "hydra")
 * @param {object} args     - مدخلات الأداة
 */
async function runTool(toolName, args = {}) {
  console.log(`[MCP] 🔧 Running tool: ${toolName}`, args);

  const result = await mcpRequest('tools/call', {
    name:      toolName,
    arguments: args,
  });

  // استخراج النص من الـ response
  if (result?.content && Array.isArray(result.content)) {
    return result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  }

  return JSON.stringify(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال أمان عالية المستوى
// ─────────────────────────────────────────────────────────────────────────────

/**
 * فحص شامل لجهاز مكتشف (يُستدعى تلقائياً من MQTT handler)
 * @param {object} device   - كائن Device من قاعدة البيانات
 * @param {string} ipAddress
 */
async function scanTarget(device, ipAddress) {
  // إنشاء سجل ScanResult بحالة "running"
  const scanRecord = await prisma.scanResult.create({
    data: {
      deviceId:    device.id,
      scanType:    'nmap',
      status:      'running',
      mcpToolUsed: 'nmap',
    },
  });

  try {
    // ── المرحلة 1: nmap سريع للمنافذ المفتوحة ─────────────────────────────
    const nmapOutput = await runTool('nmap', {
      target: ipAddress,
      flags:  '-sV -T4 --top-ports 1000',
    });

    // تحليل المنافذ من خرج nmap
    const openPorts  = extractPorts(nmapOutput);
    const portJson   = JSON.stringify(openPorts);

    console.log(`[MCP] ✅ Scan done for ${ipAddress} | Open ports: ${portJson}`);

    // ── تحديث السجل ─────────────────────────────────────────────────────
    await prisma.scanResult.update({
      where: { id: scanRecord.id },
      data: {
        openPorts: portJson,
        rawOutput: nmapOutput.slice(0, 8000), // max 8KB
        status:    'done',
      },
    });

    // ── تحديث معلومات الجهاز ──────────────────────────────────────────
    await prisma.device.update({
      where: { id: device.id },
      data:  { status: 'up' },
    });

    return { openPorts, nmapOutput };
  } catch (err) {
    console.error(`[MCP] Scan failed for ${ipAddress}:`, err.message);

    await prisma.scanResult.update({
      where: { id: scanRecord.id },
      data: {
        status:    'failed',
        rawOutput: err.message,
      },
    });

    throw err;
  }
}

/**
 * نص الـ nmap → قائمة منافذ مثل ["22/tcp", "80/tcp"]
 */
function extractPorts(nmapOutput) {
  const ports = [];
  const portRegex = /^(\d+)\/(tcp|udp)\s+open/gm;
  let match;
  while ((match = portRegex.exec(nmapOutput)) !== null) {
    ports.push(`${match[1]}/${match[2]}`);
  }
  return ports;
}

/**
 * فحص ثغرات خاص بمنفذ معين
 * @param {string} ipAddress
 * @param {number} port
 */
async function scanVulnerabilities(ipAddress, port) {
  try {
    const output = await runTool('nmap', {
      target: ipAddress,
      flags:  `-sV -p ${port} --script=vuln`,
    });
    return output;
  } catch (err) {
    console.error('[MCP] Vuln scan failed:', err.message);
    throw err;
  }
}

/**
 * فحص صحة الاتصال بـ Kali-MCP
 */
async function healthCheck() {
  try {
    const tools = await listTools();
    return {
      status:     'ok',
      toolsCount: tools.length,
      tools:      tools.map((t) => t.name),
      url:        MCP_URL,
    };
  } catch (err) {
    return {
      status:  'unreachable',
      error:   err.message,
      url:     MCP_URL,
    };
  }
}

  healthCheck,
};

/**
 * فحص هدف مخصص (دومين أو IP) من الواجهة
 * @param {string} target
 * @param {object} options
 */
async function scanCustomTarget(target, options = {}) {
  // 1. البحث عن أو إنشاء "جهاز وهمي" لربط النتائج به
  const dummyMac = `CUSTOM-${target.substring(0, 10)}`;
  
  const device = await prisma.device.upsert({
    where: { macAddress: dummyMac },
    update: { ipAddress: target, lastSeen: new Date() },
    create: { 
        macAddress: dummyMac, 
        ipAddress: target,
        hostname: target,
        status: 'up',
        vendor: 'Custom Cloud Target'
    }
  });

  // 2. إنشاء سجل الفحص
  const scanRecord = await prisma.scanResult.create({
    data: {
      deviceId:    device.id,
      scanType:    options.scanType || 'nmap_custom',
      status:      'running',
      mcpToolUsed: 'nmap',
    },
  });

  try {
    // 3. تحديد نوع الفحص (Flags)
    let flags = '-sV -T4';
    
    if (options.scanProfile === 'fast') {
      flags = '-F -T4'; // Fast scan
    } else if (options.scanProfile === 'full') {
      flags = '-p- -sV -T4'; // All 65k ports
    } else if (options.scanProfile === 'vuln') {
      flags = '-sV --script=vuln -T4'; // Vulnerability script
    } else if (options.scanProfile === 'os') {
      flags = '-O -sV -T4'; // OS Detection
    }

    if (options.ports && options.ports.length > 0) {
        flags = `-p ${options.ports} -sV -T4`; // Specific ports override
    }

    // 4. تنفيذ الفحص
    const nmapOutput = await runTool('nmap', {
      target: target,
      flags:  flags,
    });

    const openPorts  = extractPorts(nmapOutput);
    const portJson   = JSON.stringify(openPorts);

    console.log(`[MCP] ✅ Custom Scan done for ${target} | Open ports: ${portJson}`);

    await prisma.scanResult.update({
      where: { id: scanRecord.id },
      data: {
        openPorts: portJson,
        rawOutput: nmapOutput.slice(0, 8000),
        status:    'done',
      },
    });

    return { openPorts, nmapOutput };
  } catch (err) {
    console.error(`[MCP] Custom Scan failed for ${target}:`, err.message);
    await prisma.scanResult.update({
      where: { id: scanRecord.id },
      data: {
        status:    'failed',
        rawOutput: err.message,
      },
    });
    throw err;
  }
}

module.exports = {
  runTool,
  listTools,
  scanTarget,
  scanCustomTarget,
  scanVulnerabilities,
  healthCheck,
};
