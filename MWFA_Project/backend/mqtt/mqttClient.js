'use strict';

/**
 * MWFA — MQTT Client Bridge
 * ─────────────────────────────────────────────────────────────────────────────
 * يتصل بـ Mosquitto Broker ويوزع الرسائل الواردة على الـ handlers المناسبة.
 *
 * Topics المدعومة:
 *   mwfa/<deviceId>/status   — حالة الجهاز (online/offline/scanning)
 *   mwfa/<deviceId>/wifi     — نتائج WiFi Scan
 *   mwfa/<deviceId>/arp      — نتائج ARP Scan (الأجهزة المكتشفة)
 *   mwfa/<deviceId>/rf       — إشارات راديو CC1101
 *   mwfa/<deviceId>/heartbeat — نبض دوري للتأكد من الاتصال
 */

const mqtt   = require('mqtt');
const { PrismaClient } = require('@prisma/client');
const mcpService = require('../services/mcpService');

const prisma = new PrismaClient();

// ── الإعدادات من متغيرات البيئة ───────────────────────────────────────────
const MQTT_HOST     = process.env.MQTT_HOST     || 'localhost';
const MQTT_PORT     = parseInt(process.env.MQTT_PORT || '1883', 10);
const MQTT_USERNAME = process.env.MQTT_USERNAME || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';
const MQTT_PROTOCOL = process.env.MQTT_PROTOCOL || (MQTT_PORT === 8883 ? 'mqtts' : 'mqtt');
const MQTT_CLIENT_ID = `mwfa-server-${Date.now()}`;

let client = null;

// ─────────────────────────────────────────────────────────────────────────────
// الاتصال بالـ Broker
// ─────────────────────────────────────────────────────────────────────────────
function connect() {
  const brokerUrl = `${MQTT_PROTOCOL}://${MQTT_HOST}:${MQTT_PORT}`;
  console.log(`[MQTT] Connecting to broker at ${brokerUrl} ...`);

  client = mqtt.connect(brokerUrl, {
    clientId:  MQTT_CLIENT_ID,
    username:  MQTT_USERNAME || undefined,
    password:  MQTT_PASSWORD || undefined,
    clean:     true,
    reconnectPeriod: 5000,       // محاولة إعادة الاتصال كل 5 ثوانٍ
    connectTimeout:  30 * 1000,  // timeout 30 ثانية
  });

  // ── أحداث الاتصال ──────────────────────────────────────────────────────
  client.on('connect', () => {
    console.log('[MQTT] ✅ Connected to broker');
    // Subscribe على كل رسائل mwfa
    client.subscribe('mwfa/#', { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscribe error:', err);
      else     console.log('[MQTT] Subscribed to mwfa/#');
    });
  });

  client.on('reconnect', () => console.log('[MQTT] 🔄 Reconnecting...'));
  client.on('offline',   () => console.log('[MQTT] 📴 Client offline'));
  client.on('error',     (err) => console.error('[MQTT] ❌ Error:', err.message));

  // ── استقبال الرسائل ─────────────────────────────────────────────────────
  client.on('message', async (topic, rawBuffer) => {
    const payload = rawBuffer.toString();
    console.log(`[MQTT] ← ${topic} : ${payload.slice(0, 120)}...`);

    // تحليل الـ topic: mwfa/<deviceId>/<type>
    const parts = topic.split('/');
    if (parts.length < 3 || parts[0] !== 'mwfa') return;

    const deviceId  = parts[1];  // "device01"
    const eventType = parts[2];  // "status" | "wifi" | "arp" | "rf" | "heartbeat"

    // تسجيل الرسالة الخام في MqttLog
    const logEntry = await logMqttMessage(topic, payload, deviceId);

    // معالجة الرسالة
    try {
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error(`Invalid JSON in payload: ${payload.slice(0, 80)}`);
      }

      switch (eventType) {
        case 'status':
        case 'heartbeat':
          await handleStatus(deviceId, parsed);
          break;
        case 'wifi':
          await handleWifi(deviceId, parsed);
          break;
        case 'arp':
          await handleArp(deviceId, parsed);
          break;
        case 'rf':
          await handleRf(deviceId, parsed);
          break;
        case 'scan_result':
          await handleScanResult(deviceId, parsed);
          break;
        case 'proxy_status':
          await handleProxyStatus(deviceId, parsed);
          break;
        case 'tcp_result':
          await handleTcpResult(deviceId, parsed);
          break;
        case 'cmd':
          // Command topic intended for relay devices or bridge scripts, backend ignores it
          break;
        default:
          // Check for proxy_scan result topics (mwfa/results/proxy_scan/<taskId>)
          if (topic.startsWith('mwfa/results/proxy_scan/')) {
            await handleProxyScanReport(topic, parsed);
          } else {
            console.log(`[MQTT] Unknown event type: ${eventType}`);
          }
      }

      // تحديث سجل الرسالة كـ "processed"
      if (logEntry) {
        await prisma.mqttLog.update({
          where: { id: logEntry.id },
          data:  { processed: true },
        });
      }
    } catch (err) {
      console.error(`[MQTT] ❌ Error processing ${topic}:`, err.message);
      if (logEntry) {
        await prisma.mqttLog.update({
          where: { id: logEntry.id },
          data:  { error: err.message },
        });
      }
    }
  });

  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// تسجيل الرسالة في MqttLog
// ─────────────────────────────────────────────────────────────────────────────
async function logMqttMessage(topic, payload, deviceId) {
  try {
    // ابحث عن الـ RelayDevice (اختياري — قد لا يكون مسجلاً بعد)
    const relay = await prisma.relayDevice.findUnique({ where: { deviceId } });
    return await prisma.mqttLog.create({
      data: {
        topic,
        payload,
        relayDeviceId: relay?.id ?? null,
      },
    });
  } catch (err) {
    console.error('[MQTT] Failed to create MqttLog:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: mwfa/<deviceId>/status  or  /heartbeat
// Payload: { status, firmware, ip }
// ─────────────────────────────────────────────────────────────────────────────
async function handleStatus(deviceId, data) {
  await prisma.relayDevice.upsert({
    where:  { deviceId },
    update: {
      status:    data.status   || 'online',
      firmware:  data.firmware || undefined,
      ipAddress: data.ip       || undefined,
      lastSeen:  new Date(),
    },
    create: {
      deviceId,
      status:    data.status   || 'online',
      firmware:  data.firmware || undefined,
      ipAddress: data.ip       || undefined,
      lastSeen:  new Date(),
    },
  });
  console.log(`[MQTT] 📡 Device ${deviceId} status → ${data.status || 'online'}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: mwfa/<deviceId>/wifi
// Payload: { ssid, bssid, channel, rssi, encryption }
// ─────────────────────────────────────────────────────────────────────────────
async function handleWifi(deviceId, data) {
  if (!data.bssid) throw new Error('Missing bssid in wifi payload');

  const relay = await ensureRelayDevice(deviceId);

  // Upsert الشبكة
  const network = await prisma.network.upsert({
    where:  { bssid: data.bssid },
    update: {
      rssi:       data.rssi       || undefined,
      channel:    data.channel    || undefined,
      encryption: data.encryption || undefined,
      lastSeen:   new Date(),
    },
    create: {
      ssid:       data.ssid       || '(hidden)',
      bssid:      data.bssid,
      channel:    data.channel    || null,
      rssi:       data.rssi       || null,
      encryption: data.encryption || null,
    },
  });

  // تسجيل نتيجة الفحص
  await prisma.wifiScanResult.create({
    data: {
      relayDeviceId: relay.id,
      networkId:     network.id,
      rssi:          data.rssi    || null,
      channel:       data.channel || null,
    },
  });

  console.log(`[MQTT] 📶 WiFi: ${data.ssid} (${data.bssid}) | ch${data.channel} ${data.rssi}dBm`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: mwfa/<deviceId>/arp
// Payload: { macAddress, ipAddress, ssid, bssid, isGateway? }
// ─────────────────────────────────────────────────────────────────────────────
async function handleArp(deviceId, data) {
  if (!data.macAddress) throw new Error('Missing macAddress in arp payload');

  const relay = await ensureRelayDevice(deviceId);

  // Upsert الشبكة (إن وُجدت)
  let network = null;
  if (data.bssid) {
    network = await prisma.network.upsert({
      where:  { bssid: data.bssid },
      update: { lastSeen: new Date() },
      create: { ssid: data.ssid || '(unknown)', bssid: data.bssid },
    });
  }

  // Upsert الجهاز
  const device = await prisma.device.upsert({
    where:  { macAddress: data.macAddress },
    update: {
      ipAddress:  data.ipAddress  || undefined,
      networkId:  network?.id     || undefined,
      isGateway:  data.isGateway  || false,
      status:     'up',
      lastSeen:   new Date(),
    },
    create: {
      macAddress: data.macAddress,
      ipAddress:  data.ipAddress  || null,
      networkId:  network?.id     || null,
      isGateway:  data.isGateway  || false,
      status:     'up',
    },
  });

  // تسجيل نتيجة ARP
  await prisma.arpScanResult.create({
    data: {
      relayDeviceId: relay.id,
      deviceId:      device.id,
    },
  });

  console.log(`[MQTT] 🖥️  ARP: ${data.macAddress} → ${data.ipAddress}`);

  // ── لا نقوم بفحص تلقائي مباشر بعد الآن ──────────────
  // الكالي لينكس لا يملك صلاحية دخول الشبكة المحلية من Railway
  // سنستبدله لاحقاً بنظام إرسال أوامر عبر MQTT للقطعة لتفحص هي.
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: mwfa/<deviceId>/rf
// Payload: { frequency, protocol, bits, value, rawData, rssi, duration }
// ─────────────────────────────────────────────────────────────────────────────
async function handleRf(deviceId, data) {
  if (!data.frequency) throw new Error('Missing frequency in rf payload');

  const relay = await ensureRelayDevice(deviceId);

  await prisma.rfSignal.create({
    data: {
      relayDeviceId: relay.id,
      frequency:     parseFloat(data.frequency),
      protocol:      data.protocol || null,
      bits:          data.bits     ? parseInt(data.bits) : null,
      value:         data.value    ? String(data.value)  : null,
      rawData:       data.rawData  || null,
      rssi:          data.rssi     ? parseInt(data.rssi) : null,
      duration:      data.duration ? parseInt(data.duration) : null,
    },
  });

  console.log(`[MQTT] 📻 RF: ${data.frequency}MHz | ${data.protocol || 'RAW'} | val=${data.value}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: mwfa/<deviceId>/scan_result
// Payload: { target: "192.168.1.1", openPorts: [80, 443] }
// ─────────────────────────────────────────────────────────────────────────────
async function handleScanResult(deviceId, data) {
  if (!data.target) throw new Error('Missing target in scan_result payload');

  const relay = await ensureRelayDevice(deviceId);

  // البحث عن الجهاز حسب IP
  const device = await prisma.device.findFirst({
    where: { ipAddress: data.target },
    orderBy: { lastSeen: 'desc' }
  });

  if (!device) {
      console.warn(`[MQTT] Received scan result for ${data.target} but device not found in DB`);
      return;
  }

  // تحديث حالة القيد "running" الخاص بالفحص
  const scanRecord = await prisma.scanResult.findFirst({
      where: { deviceId: device.id, status: 'running', scanType: 'reverse_port_scan' },
      orderBy: { scannedAt: 'desc' }
  });

  if (scanRecord) {
      await prisma.scanResult.update({
          where: { id: scanRecord.id },
          data: {
              status: 'done',
              openPorts: JSON.stringify(data.openPorts || []),
              rawOutput: `TCP Scan from T-Embed. Open ports: ${(data.openPorts || []).join(', ')}`
          }
      });
  } else {
      // إذا لم يكن هناك قيد مسبق، قم بإنشائه
      await prisma.scanResult.create({
          data: {
              deviceId: device.id,
              scanType: 'reverse_port_scan',
              status: 'done',
              mcpToolUsed: 'tembed_tcp',
              openPorts: JSON.stringify(data.openPorts || []),
              rawOutput: `TCP Scan from T-Embed. Open ports: ${(data.openPorts || []).join(', ')}`
          }
      });
  }

  console.log(`[MQTT] 🚀 Scan Result for ${data.target}: Open Ports [${(data.openPorts || []).join(', ')}]`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: mwfa/<deviceId>/proxy_status
// Payload: { status, localIp, gateway, subnet, ssid, bssid }
// ─────────────────────────────────────────────────────────────────────────────
async function handleProxyStatus(deviceId, data) {
  const subnetInfo = JSON.stringify({
    localIp: data.localIp || null,
    gateway: data.gateway || null,
    subnet:  data.subnet  || null,
    ssid:    data.ssid    || null,
    bssid:   data.bssid   || null,
  });

  await prisma.relayDevice.upsert({
    where:  { deviceId },
    update: {
      proxyStatus: data.status || 'unknown',
      subnetInfo,
      lastSeen: new Date(),
      status: 'online',
    },
    create: {
      deviceId,
      proxyStatus: data.status || 'unknown',
      subnetInfo,
      status: 'online',
      lastSeen: new Date(),
    },
  });

  console.log(`[MQTT] 🔧 Proxy Status for ${deviceId}: ${data.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: mwfa/<deviceId>/tcp_result
// Payload: { ip, port, state, ms, banner, task_id } or { event: "scan_complete", ... }
// ─────────────────────────────────────────────────────────────────────────────
async function handleTcpResult(deviceId, data) {
  // Ignore scan_complete events (just status updates)
  if (data.event === 'scan_complete') {
    console.log(`[MQTT] 📊 Scan complete for ${data.ip}: ${data.openCount}/${data.total} open`);
    return;
  }

  if (!data.ip || !data.port) {
    console.warn('[MQTT] tcp_result missing ip or port');
    return;
  }

  try {
    await prisma.proxyScanResult.create({
      data: {
        taskId:     data.task_id || `auto_${Date.now()}`,
        targetIp:   data.ip,
        port:       parseInt(data.port),
        state:      data.state || 'unknown',
        banner:     data.banner || null,
        responseMs: data.ms ? parseInt(data.ms) : null,
        tembedId:   deviceId,
      },
    });

    if (data.state === 'open') {
      console.log(`[MQTT] 🟢 TCP ${data.ip}:${data.port} → OPEN${data.banner ? ' [' + data.banner.substring(0, 30) + ']' : ''}`);
    }
  } catch (err) {
    console.error('[MQTT] Failed to save tcp_result:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: mwfa/results/proxy_scan/<taskId>
// Payload: { task_id, targets, profile, results, report, timestamp }
// ─────────────────────────────────────────────────────────────────────────────
async function handleProxyScanReport(topic, data) {
  const taskId = data.task_id || topic.split('/').pop();
  
  console.log(`[MQTT] 📋 Proxy Scan Report received — Task: ${taskId}`);

  if (data.error) {
    console.error(`[MQTT] Proxy scan error: ${data.error}`);
    return;
  }

  // Save report as ScanResult for each target
  for (const target of (data.targets || [])) {
    const targetResults = (data.results || {})[target] || [];
    const openPorts = targetResults
      .filter(r => r.state === 'open')
      .map(r => `${r.port}/tcp`);

    // Find or create device record for this target
    const dummyMac = `PROXY-${target.replace(/[^a-zA-Z0-9]/g, '').substring(0, 12)}`;
    const device = await prisma.device.upsert({
      where:  { macAddress: dummyMac },
      update: { ipAddress: target, lastSeen: new Date(), status: 'up' },
      create: {
        macAddress: dummyMac,
        ipAddress:  target,
        hostname:   target,
        status:     'up',
        vendor:     'Proxy Deep Scan Target',
      },
    });

    await prisma.scanResult.create({
      data: {
        deviceId:    device.id,
        scanType:    'proxy_deep_scan',
        status:      'done',
        mcpToolUsed: 'tembed_tcp_proxy',
        openPorts:   JSON.stringify(openPorts),
        rawOutput:   (data.report || '').slice(0, 10000),
      },
    });
  }

  console.log(`[MQTT] ✅ Proxy scan report saved for ${(data.targets || []).length} target(s)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: تأكد من وجود RelayDevice وإنشائه إن لم يكن موجوداً
// ─────────────────────────────────────────────────────────────────────────────
async function ensureRelayDevice(deviceId) {
  return prisma.relayDevice.upsert({
    where:  { deviceId },
    update: { lastSeen: new Date(), status: 'online' },
    create: { deviceId, status: 'online', lastSeen: new Date() },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// الـ API الخارجي
// ─────────────────────────────────────────────────────────────────────────────
function publish(topic, payload) {
  if (!client || !client.connected) {
    console.warn('[MQTT] Cannot publish — not connected');
    return;
  }
  const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
  client.publish(topic, msg, { qos: 1 });
}

function getClient() { return client; }

module.exports = { connect, publish, getClient };
