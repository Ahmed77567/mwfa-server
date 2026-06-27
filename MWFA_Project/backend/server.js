'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const { PrismaClient } = require('@prisma/client');

// ── MWFA Modules ──────────────────────────────────────────────────────────────
const mqttClient = require('./mqtt/mqttClient');
const mcpService = require('./services/mcpService');

// ─────────────────────────────────────────────────────────────────────────────
const app    = express();
const prisma = new PrismaClient();
const PORT   = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ROUTES — System
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** GET /api/health — فحص صحة النظام */
app.get('/api/health', async (req, res) => {
  const mqttConnected = mqttClient.getClient()?.connected ?? false;
  const mcpStatus     = await mcpService.healthCheck();

  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    mqtt:      { connected: mqttConnected },
    mcp:       mcpStatus,
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ROUTES — Relay Devices (T-Embed units)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** GET /api/relays — جميع أجهزة T-Embed */
app.get('/api/relays', async (req, res) => {
  try {
    const relays = await prisma.relayDevice.findMany({
      orderBy: { lastSeen: 'desc' },
      include: {
        _count: {
          select: {
            wifiScans: true,
            arpScans:  true,
            rfSignals: true,
          },
        },
      },
    });
    res.json(relays);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/relays/:deviceId — تفاصيل جهاز واحد */
app.get('/api/relays/:deviceId', async (req, res) => {
  try {
    const relay = await prisma.relayDevice.findUnique({
      where:   { deviceId: req.params.deviceId },
      include: {
        wifiScans: { take: 20, orderBy: { scannedAt: 'desc' } },
        arpScans:  { take: 20, orderBy: { scannedAt: 'desc' }, include: { device: true } },
        rfSignals: { take: 20, orderBy: { capturedAt: 'desc' } },
      },
    });
    if (!relay) return res.status(404).json({ error: 'Device not found' });
    res.json(relay);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ROUTES — Networks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** GET /api/networks — جميع الشبكات المكتشفة */
app.get('/api/networks', async (req, res) => {
  try {
    const networks = await prisma.network.findMany({
      orderBy: { lastSeen: 'desc' },
      include: {
        _count: { select: { devices: true } },
      },
    });
    res.json(networks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ROUTES — Devices (ARP discovered)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** GET /api/devices — جميع الأجهزة المكتشفة */
app.get('/api/devices', async (req, res) => {
  try {
    const { networkId, status } = req.query;
    const where = {};
    if (networkId) where.networkId = parseInt(networkId);
    if (status)    where.status    = status;

    const devices = await prisma.device.findMany({
      where,
      orderBy: { lastSeen: 'desc' },
      include: {
        network:     true,
        scanResults: { take: 1, orderBy: { scannedAt: 'desc' } },
      },
    });
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/devices/:id — تفاصيل جهاز */
app.get('/api/devices/:id', async (req, res) => {
  try {
    const device = await prisma.device.findUnique({
      where:   { id: parseInt(req.params.id) },
      include: {
        network:     true,
        scanResults: { orderBy: { scannedAt: 'desc' } },
        arpScans:    { take: 10, orderBy: { scannedAt: 'desc' } },
      },
    });
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ROUTES — RF Signals
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** GET /api/rf — إشارات الراديو المُلتقطة */
app.get('/api/rf', async (req, res) => {
  try {
    const { deviceId, frequency } = req.query;
    const where = {};
    if (deviceId) {
      const relay = await prisma.relayDevice.findUnique({ where: { deviceId } });
      if (relay) where.relayDeviceId = relay.id;
    }
    if (frequency) where.frequency = parseFloat(frequency);

    const signals = await prisma.rfSignal.findMany({
      where,
      orderBy: { capturedAt: 'desc' },
      take:    100,
      include: { relayDevice: { select: { deviceId: true, label: true } } },
    });
    res.json(signals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ROUTES — Scan Results (MCP output)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** GET /api/scans — نتائج فحص الأمان */
app.get('/api/scans', async (req, res) => {
  try {
    const scans = await prisma.scanResult.findMany({
      orderBy: { scannedAt: 'desc' },
      take:    50,
      include: { device: true },
    });
    res.json(scans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/scans/trigger — تشغيل فحص عكسي عبر القطعة */
app.post('/api/scans/trigger', async (req, res) => {
  const { deviceId, scanProfile, ports } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

  try {
    const device = await prisma.device.findUnique({ 
        where: { id: parseInt(deviceId) },
    });
    
    if (!device)           return res.status(404).json({ error: 'Device not found' });
    if (!device.ipAddress) return res.status(400).json({ error: 'Device has no IP address' });

    mcpService.scanTarget(device, device.ipAddress, { scanProfile, ports }).catch(err => {
        console.error('Background MCP scan failed:', err);
    });

    res.json({ 
      message: `Scan started for ${device.ipAddress}`,
      target:  device.ipAddress,
      profile: scanProfile || 'default',
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/scans/custom — فحص هدف مخصص خارجي */
app.post('/api/scans/custom', async (req, res) => {
  const { target, scanProfile, ports } = req.body;
  if (!target) return res.status(400).json({ error: 'target (IP or domain) is required' });

  try {
    // We don't await this so it runs in the background
    mcpService.scanCustomTarget(target, { scanProfile, ports }).catch(err => {
        console.error("Background Custom MCP scan failed:", err);
    });

    res.json({ message: `Cloud scan started for ${target} via Railway MCP`, target: target });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ROUTES — Legacy HTTP Ingest (للتوافق مع الكود القديم)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** POST /api/ingest — الـ endpoint القديم (HTTP من الفيرموير القديم) */
app.post('/api/ingest', async (req, res) => {
  const { macAddress, ipAddress, ssid, bssid } = req.body;

  try {
    let networkId = null;
    if (ssid && bssid) {
      const network = await prisma.network.upsert({
        where:  { bssid },
        update: { lastSeen: new Date() },
        create: { ssid, bssid },
      });
      networkId = network.id;
    }

    if (macAddress) {
      await prisma.device.upsert({
        where:  { macAddress },
        update: { ipAddress: ipAddress || null, networkId, lastSeen: new Date(), status: 'up' },
        create: { macAddress, ipAddress: ipAddress || null, networkId },
      });
    }

    res.status(200).json({ message: 'Data received (legacy HTTP)' });
    console.log(`[HTTP/Legacy] Logged Device MAC: ${macAddress} | IP: ${ipAddress}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MQTT Logs (للـ debugging)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** GET /api/logs — آخر رسائل MQTT */
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await prisma.mqttLog.findMany({
      orderBy: { receivedAt: 'desc' },
      take:    100,
      include: { relayDevice: { select: { deviceId: true } } },
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Startup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function start() {
  // تأكد من الاتصال بالـ DB
  await prisma.$connect();
  console.log('[DB] ✅ Prisma connected');

  // بدء الاستماع على MQTT
  mqttClient.connect();

  // تشغيل الـ HTTP Server
  app.listen(PORT, () => {
    console.log(`\n🚀 MWFA Backend running on http://0.0.0.0:${PORT}`);
    console.log('   Routes:');
    console.log('   GET  /api/health');
    console.log('   GET  /api/relays');
    console.log('   GET  /api/networks');
    console.log('   GET  /api/devices');
    console.log('   GET  /api/rf');
    console.log('   GET  /api/scans');
    console.log('   POST /api/scans/trigger');
    console.log('   GET  /api/logs\n');
  });
}

start().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
