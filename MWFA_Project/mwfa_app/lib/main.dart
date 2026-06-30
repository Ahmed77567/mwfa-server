import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:mqtt_client/mqtt_client.dart';
import 'package:mqtt_client/mqtt_server_client.dart';

void main() {
  runApp(const MWFAApp());
}

class MWFAApp extends StatelessWidget {
  const MWFAApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MWFA Dashboard',
      theme: ThemeData(
        brightness: Brightness.dark,
        primarySwatch: Colors.deepPurple,
        scaffoldBackgroundColor: const Color(0xFF0A0A0F),
        cardTheme: CardThemeData(
          color: const Color(0xFF1A1A2E),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
      home: const DashboardScreen(),
    );
  }
}

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> with SingleTickerProviderStateMixin {
  final String broker = '3f5f4470310e4cddaae686f16146fdc8.s1.eu.hivemq.cloud';
  final int port = 8883;
  
  MqttServerClient? client;
  String connectionStatus = 'Disconnected';
  List<Map<String, dynamic>> messages = [];
  
  // Proxy Deep Scan State
  String proxyStatus = 'inactive'; // inactive, activating, ready, scanning, stopped
  String kaliAgentStatus = 'offline'; // online, offline
  String? proxySubnet;
  String? proxyGateway;
  String? proxyLocalIp;
  List<Map<String, dynamic>> tcpResults = [];
  String? activeTaskId;
  int scannedPorts = 0;
  int openPorts = 0;
  String? scanReport;
  
  final TextEditingController _targetController = TextEditingController();
  final TextEditingController _flagsController = TextEditingController(text: '-F');
  final TextEditingController _proxyTargetController = TextEditingController();
  final TextEditingController _customPortsController = TextEditingController();
  
  String selectedProfile = 'fast';
  
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    if (kIsWeb) {
      setState(() {
        connectionStatus = 'Error: Web not supported for raw TCP MQTT. Please run on Windows/Android.';
        messages.add({"type": "system", "text": "Chrome/Web testing does not support standard MQTT over TCP."});
      });
    } else {
      _connectMQTT();
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _connectMQTT() async {
    setState(() => connectionStatus = 'Connecting...');
    
    if (client != null) {
      client!.onDisconnected = null;
      client!.onConnected = null;
      if (client!.connectionStatus?.state == MqttConnectionState.connected) {
        client!.disconnect();
      }
    }

    try {
      final newClientId = 'app_${DateTime.now().millisecondsSinceEpoch % 100000}';
      client = MqttServerClient.withPort(broker, newClientId, port);
      client!.secure = true;
      client!.setProtocolV311();
      client!.keepAlivePeriod = 60;
      client!.onBadCertificate = (dynamic cert) => true;

      client!.onDisconnected = () {
        setState(() => connectionStatus = 'Disconnected');
      };
      client!.onConnected = () {
        setState(() => connectionStatus = 'Connected to HiveMQ');
      };

      final MqttConnectMessage connMess = MqttConnectMessage()
          .withClientIdentifier(newClientId)
          .authenticateAs('ahmed_mwfa', '7XP@un@VYvdPjwS')
          .startClean();
      
      client!.connectionMessage = connMess;
      await client!.connect();
    } catch (e) {
      setState(() => connectionStatus = 'Error: $e');
      client?.disconnect();
      return;
    }

    if (client!.connectionStatus!.state == MqttConnectionState.connected) {
      // Subscribe to all relevant topics
      client!.subscribe('mwfa/results/#', MqttQos.atLeastOnce);
      client!.subscribe('mwfa/data/#', MqttQos.atLeastOnce);
      client!.subscribe('mwfa/tembed01/proxy_status', MqttQos.atLeastOnce);
      client!.subscribe('mwfa/tembed01/tcp_result', MqttQos.atLeastOnce);
      client!.subscribe('mwfa/kali01/status', MqttQos.atLeastOnce);

      client!.updates!.listen((List<MqttReceivedMessage<MqttMessage>> c) {
        final MqttPublishMessage recMess = c[0].payload as MqttPublishMessage;
        final String pt = MqttPublishPayload.bytesToStringAsString(recMess.payload.message);
        final String topic = c[0].topic;
        
        setState(() {
          try {
            final parsed = jsonDecode(pt);
            
            // ── Handle Proxy Status ──────────────────────────────────
            if (topic.contains('/proxy_status')) {
              _handleProxyStatus(parsed);
              return;
            }
            
            // ── Handle TCP Result ────────────────────────────────────
            if (topic.contains('/tcp_result')) {
              _handleTcpResult(parsed);
              return;
            }
            
            // ── Handle Proxy Scan Report ─────────────────────────────
            if (topic.contains('/proxy_scan/')) {
              _handleProxyScanReport(parsed);
              return;
            }
            
            // ── Handle Kali Agent Status ─────────────────────────────
            if (topic == 'mwfa/kali01/status') {
              setState(() {
                kaliAgentStatus = parsed['status'] ?? 'offline';
              });
              return;
            }
            
            // ── Legacy result handling ────────────────────────────────
            messages.insert(0, {"type": "result", "topic": topic, "data": parsed});
          } catch (e) {
            messages.insert(0, {"type": "raw", "topic": topic, "text": pt});
          }
        });
      });
    } else {
      setState(() => connectionStatus = 'Failed to connect');
      client!.disconnect();
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Proxy Status Handler
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  void _handleProxyStatus(Map<String, dynamic> data) {
    proxyStatus = data['status'] ?? 'unknown';
    proxyLocalIp = data['localIp'];
    proxyGateway = data['gateway'];
    proxySubnet = data['subnet'];
    
    messages.insert(0, {
      "type": "system",
      "text": "🔧 Proxy Status: $proxyStatus | IP: ${proxyLocalIp ?? 'N/A'} | GW: ${proxyGateway ?? 'N/A'}"
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  TCP Result Handler
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  void _handleTcpResult(Map<String, dynamic> data) {
    // Check if scan_complete event
    if (data['event'] == 'scan_complete') {
      messages.insert(0, {
        "type": "system",
        "text": "📊 Scan complete for ${data['ip']}: ${data['openCount']}/${data['total']} open ports"
      });
      return;
    }
    
    scannedPorts++;
    if (data['state'] == 'open') {
      openPorts++;
      tcpResults.insert(0, data);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Proxy Scan Report Handler
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  void _handleProxyScanReport(Map<String, dynamic> data) {
    proxyStatus = 'ready';
    scanReport = data['report'];
    activeTaskId = null;
    
    messages.insert(0, {
      "type": "system",
      "text": "✅ Deep Scan Report received — ${data['targets']?.length ?? 0} target(s)"
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Actions
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  void _triggerScan() {
    if (client != null && client!.connectionStatus?.state == MqttConnectionState.connected) {
      final builder = MqttClientPayloadBuilder();
      final payload = jsonEncode({
        "command": "scan",
        "target": _targetController.text.isNotEmpty ? _targetController.text : "scanme.nmap.org",
        "flags": _flagsController.text.isNotEmpty ? _flagsController.text : "-F"
      });
      builder.addString(payload);
      client!.publishMessage('mwfa/commands/kali01', MqttQos.atLeastOnce, builder.payload!);
      
      setState(() {
        messages.insert(0, {"type": "out", "topic": "mwfa/commands/kali01", "payload": payload});
      });
    } else {
      _showSnackBar('MQTT is not connected');
    }
  }

  void _establishProxy() {
    if (client == null || client!.connectionStatus?.state != MqttConnectionState.connected) {
      _showSnackBar('MQTT is not connected');
      return;
    }

    setState(() {
      proxyStatus = 'activating';
      tcpResults.clear();
      scannedPorts = 0;
      openPorts = 0;
      scanReport = null;
    });

    final builder = MqttClientPayloadBuilder();
    builder.addString(jsonEncode({"command": "establish_proxy"}));
    client!.publishMessage('mwfa/commands/tembed01', MqttQos.atLeastOnce, builder.payload!);
    
    setState(() {
      messages.insert(0, {"type": "out", "topic": "mwfa/commands/tembed01", "payload": '{"command":"establish_proxy"}'});
    });
  }

  void _startProxyScan() {
    if (client == null || client!.connectionStatus?.state != MqttConnectionState.connected) {
      _showSnackBar('MQTT is not connected');
      return;
    }

    if (proxyStatus != 'ready') {
      _showSnackBar('Proxy agent is not ready');
      return;
    }

    final targets = _proxyTargetController.text
        .split(RegExp(r'[,\s]+'))
        .where((t) => t.isNotEmpty)
        .toList();

    if (targets.isEmpty) {
      _showSnackBar('Enter at least one target IP');
      return;
    }

    final taskId = 'pscan_${DateTime.now().millisecondsSinceEpoch}';

    setState(() {
      proxyStatus = 'scanning';
      activeTaskId = taskId;
      tcpResults.clear();
      scannedPorts = 0;
      openPorts = 0;
      scanReport = null;
    });

    final builder = MqttClientPayloadBuilder();
    final payload = jsonEncode({
      "command": "proxy_scan",
      "targets": targets,
      "scanProfile": selectedProfile,
      "customPorts": selectedProfile == 'custom' ? _customPortsController.text : "",
      "task_id": activeTaskId,
      "tembedId": "tembed01"
    });
    builder.addString(payload);
    client!.publishMessage('mwfa/commands/kali01', MqttQos.atLeastOnce, builder.payload!);
    
    setState(() {
      messages.insert(0, {
        "type": "out",
        "topic": "mwfa/commands/kali01",
        "payload": 'proxy_scan → ${targets.join(", ")} [$selectedProfile]'
      });
    });
  }

  void _stopProxy() {
    if (client == null || client!.connectionStatus?.state != MqttConnectionState.connected) return;

    final builder = MqttClientPayloadBuilder();
    builder.addString(jsonEncode({"command": "stop_proxy"}));
    client!.publishMessage('mwfa/commands/tembed01', MqttQos.atLeastOnce, builder.payload!);
    
    setState(() {
      proxyStatus = 'inactive';
      activeTaskId = null;
    });
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: Colors.red.shade800),
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Build
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('MWFA Relay Dashboard', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: const Color(0xFF0D0D1A),
        elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: Colors.deepPurpleAccent,
          tabs: const [
            Tab(icon: Icon(Icons.radar), text: 'Scan'),
            Tab(icon: Icon(Icons.shield), text: 'Deep Scan'),
            Tab(icon: Icon(Icons.list_alt), text: 'Log'),
          ],
        ),
      ),
      body: Column(
        children: [
          // Connection Status Bar
          _buildConnectionBar(),
          
          // Tab Content
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _buildScanTab(),
                _buildDeepScanTab(),
                _buildLogTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConnectionBar() {
    bool brokerConnected = connectionStatus.contains('Connected');
    // If the broker is disconnected, force the other statuses to appear offline
    bool kaliOnline = brokerConnected && (kaliAgentStatus == 'online');
    bool tembedOnline = brokerConnected && (proxyStatus != 'offline' && proxyStatus != 'inactive' && proxyStatus != 'unknown');

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF161622),
        border: const Border(bottom: BorderSide(color: Colors.white10)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _buildStatusChip('Broker', brokerConnected),
          _buildStatusChip('Kali Agent', kaliOnline),
          _buildStatusChip('T-Embed', tembedOnline),
          InkWell(
            onTap: _connectMQTT,
            child: const Padding(
              padding: EdgeInsets.all(4.0),
              child: Icon(Icons.refresh, size: 18, color: Colors.white70),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusChip(String label, bool isOnline) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: isOnline ? Colors.green.withOpacity(0.15) : Colors.red.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isOnline ? Colors.green : Colors.redAccent,
          width: 1,
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: isOnline ? Colors.green : Colors.redAccent,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: isOnline ? Colors.green : Colors.redAccent,
                  blurRadius: 4,
                )
              ],
            ),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.bold,
              color: isOnline ? Colors.green : Colors.redAccent,
            ),
          ),
        ],
      ),
    );
  }

  // ── Tab 1: Legacy Scan ─────────────────────────────────────────────────
  Widget _buildScanTab() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    flex: 2,
                    child: TextField(
                      controller: _targetController,
                      decoration: InputDecoration(
                        labelText: 'Target IP / Domain',
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                        filled: true,
                        fillColor: const Color(0xFF16213E),
                        prefixIcon: const Icon(Icons.dns, size: 18),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 1,
                    child: TextField(
                      controller: _flagsController,
                      decoration: InputDecoration(
                        labelText: 'Flags',
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                        filled: true,
                        fillColor: const Color(0xFF16213E),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _triggerScan,
                  icon: const Icon(Icons.radar),
                  label: const Text('Scan (Kali Direct)'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.deepPurpleAccent,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
            ],
          ),
        ),
        const Divider(color: Colors.white10),
        Expanded(child: _buildMessageList()),
      ],
    );
  }

  // ── Tab 2: Deep Scan (Proxy) ───────────────────────────────────────────
  Widget _buildDeepScanTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Proxy Status Card ──────────────────────────────────────
          _buildProxyStatusCard(),
          const SizedBox(height: 16),
          
          // ── Scan Controls ──────────────────────────────────────────
          if (proxyStatus == 'ready' || proxyStatus == 'scanning')
            _buildScanControls(),
          
          // ── Live Results ───────────────────────────────────────────
          if (tcpResults.isNotEmpty || scannedPorts > 0)
            _buildLiveResults(),
          
          // ── Full Report ────────────────────────────────────────────
          if (scanReport != null)
            _buildReportCard(),
        ],
      ),
    );
  }

  Widget _buildProxyStatusCard() {
    IconData statusIcon;
    Color statusColor;
    String statusText;

    switch (proxyStatus) {
      case 'activating':
        statusIcon = Icons.sync;
        statusColor = Colors.orange;
        statusText = 'Activating Agent on T-Embed...';
        break;
      case 'ready':
        statusIcon = Icons.check_circle;
        statusColor = Colors.greenAccent;
        statusText = 'Agent Ready';
        break;
      case 'scanning':
        statusIcon = Icons.radar;
        statusColor = Colors.blueAccent;
        statusText = 'Scanning...';
        break;
      case 'stopped':
        statusIcon = Icons.stop_circle;
        statusColor = Colors.grey;
        statusText = 'Agent Stopped';
        break;
      case 'offline':
        statusIcon = Icons.wifi_off;
        statusColor = Colors.redAccent;
        statusText = 'Device Offline / Disconnected';
        break;
      case 'inactive':
      default:
        statusIcon = Icons.power_off;
        statusColor = Colors.grey;
        statusText = 'Agent Inactive (Click Activate)';
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(statusIcon, color: statusColor, size: 28),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('T-Embed Agent', 
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: statusColor)),
                      Text(statusText, style: const TextStyle(color: Colors.white60, fontSize: 13)),
                    ],
                  ),
                ),
                // Kali Agent Status Badge
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: kaliAgentStatus == 'online' ? Colors.green.withOpacity(0.2) : Colors.red.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: kaliAgentStatus == 'online' ? Colors.green : Colors.redAccent,
                      width: 1
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        kaliAgentStatus == 'online' ? Icons.computer : Icons.desktop_access_disabled,
                        size: 14,
                        color: kaliAgentStatus == 'online' ? Colors.green : Colors.redAccent,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        kaliAgentStatus == 'online' ? 'Kali: Online' : 'Kali: Offline',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: kaliAgentStatus == 'online' ? Colors.green : Colors.redAccent,
                        ),
                      ),
                    ],
                  ),
                ),
                if (proxyStatus == 'activating')
                  const Padding(
                    padding: EdgeInsets.only(left: 12),
                    child: SizedBox(width: 20, height: 20, 
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.orange)),
                  ),
              ],
            ),
            if (proxyLocalIp != null && proxyStatus == 'ready') ...[
              const SizedBox(height: 12),
              const Divider(color: Colors.white10),
              const SizedBox(height: 8),
              _infoRow('Local IP', proxyLocalIp!),
              _infoRow('Gateway', proxyGateway ?? 'N/A'),
              _infoRow('Subnet', proxySubnet ?? 'N/A'),
            ],
            const SizedBox(height: 16),
            Row(
              children: [
                if (proxyStatus == 'inactive' || proxyStatus == 'stopped' || proxyStatus == 'offline')
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: _establishProxy,
                      icon: const Icon(Icons.power_settings_new),
                      label: const Text('Activate Agent'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFFF6B35),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                if (proxyStatus == 'ready' || proxyStatus == 'scanning') ...[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _stopProxy,
                      icon: const Icon(Icons.stop, color: Colors.redAccent),
                      label: const Text('Stop Agent', style: TextStyle(color: Colors.redAccent)),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Colors.redAccent),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildScanControls() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('🎯 Scan Configuration', 
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            TextField(
              controller: _proxyTargetController,
              decoration: InputDecoration(
                labelText: 'Target IPs (comma-separated)',
                hintText: '192.168.1.1, 192.168.1.10',
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                filled: true,
                fillColor: const Color(0xFF16213E),
                prefixIcon: const Icon(Icons.gps_fixed, size: 18),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                const Text('Profile: ', style: TextStyle(color: Colors.white70)),
                const SizedBox(width: 8),
                ChoiceChip(
                  label: const Text('Fast (21 ports)'),
                  selected: selectedProfile == 'fast',
                  onSelected: (s) => setState(() => selectedProfile = 'fast'),
                  selectedColor: Colors.deepPurpleAccent,
                ),
                const SizedBox(width: 8),
                ChoiceChip(
                  label: const Text('Default (100 ports)'),
                  selected: selectedProfile == 'default',
                  onSelected: (s) => setState(() => selectedProfile = 'default'),
                  selectedColor: Colors.deepPurpleAccent,
                ),
                const SizedBox(width: 8),
                ChoiceChip(
                  label: const Text('Top 100'),
                  selected: selectedProfile == 'top100',
                  onSelected: (s) => setState(() => selectedProfile = 'top100'),
                  selectedColor: Colors.deepPurpleAccent,
                ),
                const SizedBox(width: 8),
                ChoiceChip(
                  label: const Text('Custom'),
                  selected: selectedProfile == 'custom',
                  onSelected: (s) => setState(() => selectedProfile = 'custom'),
                  selectedColor: Colors.deepPurpleAccent,
                ),
              ],
            ),
            if (selectedProfile == 'custom') ...[
              const SizedBox(height: 12),
              TextField(
                controller: _customPortsController,
                decoration: InputDecoration(
                  labelText: 'Custom Ports (e.g. 80,443,8080-8090)',
                  hintText: '80, 443, 8080-8090',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                  filled: true,
                  fillColor: const Color(0xFF16213E),
                  prefixIcon: const Icon(Icons.numbers, size: 18),
                ),
              ),
            ],
            const SizedBox(height: 16),
            if (kaliAgentStatus != 'online')
              Container(
                padding: const EdgeInsets.all(8),
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: Colors.red.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.redAccent.withOpacity(0.5)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.warning_amber_rounded, color: Colors.redAccent, size: 16),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text('Kali Agent is offline. Start `agent.py` to run deep scans.',
                        style: TextStyle(color: Colors.redAccent, fontSize: 11)),
                    ),
                  ],
                ),
              ),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: (proxyStatus == 'scanning' || kaliAgentStatus != 'online') ? null : _startProxyScan,
                icon: Icon(proxyStatus == 'scanning' ? Icons.hourglass_top : Icons.security),
                label: Text(proxyStatus == 'scanning' ? 'Scanning...' : 'Start Deep Scan'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: proxyStatus == 'scanning' ? Colors.grey : Colors.red.shade700,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLiveResults() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('📡 Live Results', 
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                    Text('Scanned: $scannedPorts | Open: $openPorts',
                      style: const TextStyle(color: Colors.white60, fontSize: 12)),
                  ],
                ),
                if (proxyStatus == 'scanning') ...[
                  const SizedBox(height: 8),
                  LinearProgressIndicator(
                    backgroundColor: Colors.white10,
                    valueColor: AlwaysStoppedAnimation<Color>(Colors.deepPurpleAccent.withOpacity(0.8)),
                  ),
                ],
                const SizedBox(height: 12),
                
                // Results Table
                if (tcpResults.isNotEmpty)
                  Container(
                    decoration: BoxDecoration(
                      color: Colors.black26,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Column(
                      children: [
                        // Header
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: const BoxDecoration(
                            color: Colors.white10,
                            borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
                          ),
                          child: const Row(
                            children: [
                              Expanded(flex: 3, child: Text('IP', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12))),
                              Expanded(flex: 2, child: Text('PORT', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12))),
                              Expanded(flex: 2, child: Text('STATE', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12))),
                              Expanded(flex: 2, child: Text('TIME', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12))),
                              Expanded(flex: 3, child: Text('BANNER', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12))),
                            ],
                          ),
                        ),
                        // Rows
                        ...tcpResults.take(50).map((r) => Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          decoration: const BoxDecoration(
                            border: Border(bottom: BorderSide(color: Colors.white10)),
                          ),
                          child: Row(
                            children: [
                              Expanded(flex: 3, child: Text('${r['ip'] ?? ''}', 
                                style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.white70))),
                              Expanded(flex: 2, child: Text('${r['port'] ?? ''}', 
                                style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.white70))),
                              Expanded(flex: 2, child: Text('${r['state'] ?? ''}',
                                style: TextStyle(
                                  fontFamily: 'monospace', fontSize: 11,
                                  color: r['state'] == 'open' ? Colors.greenAccent : Colors.redAccent,
                                  fontWeight: FontWeight.bold,
                                ))),
                              Expanded(flex: 2, child: Text('${r['ms'] ?? 0}ms', 
                                style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.white54))),
                              Expanded(flex: 3, child: Text('${r['banner'] ?? ''}', 
                                style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.amberAccent),
                                overflow: TextOverflow.ellipsis)),
                            ],
                          ),
                        )),
                      ],
                    ),
                  ),
                
                if (tcpResults.isEmpty && scannedPorts > 0)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('No open ports found yet...', 
                      style: TextStyle(color: Colors.white38, fontStyle: FontStyle.italic)),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildReportCard() {
    return Column(
      children: [
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.description, color: Colors.greenAccent, size: 20),
                    SizedBox(width: 8),
                    Text('📋 Full Scan Report', 
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Colors.greenAccent)),
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.black,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: SelectableText(
                    scanReport ?? '',
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.white70),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(width: 80, child: Text(label, style: const TextStyle(color: Colors.white38, fontSize: 12))),
          Text(value, style: const TextStyle(fontFamily: 'monospace', fontSize: 13, color: Colors.white70)),
        ],
      ),
    );
  }

  // ── Tab 3: Message Log ─────────────────────────────────────────────────
  Widget _buildLogTab() {
    return _buildMessageList();
  }

  Widget _buildMessageList() {
    return ListView.builder(
      itemCount: messages.length,
      itemBuilder: (context, index) {
        final msg = messages[index];
        
        if (msg['type'] == 'result') {
          final data = msg['data'];
          final target = data['target'] ?? 'Unknown';
          final status = data['result']?['status'] ?? 'Unknown';
          final output = data['result']?['output'] ?? 'No output';
          
          return Card(
            margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            child: Padding(
              padding: const EdgeInsets.all(12.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text("🎯 Target: $target", style: const TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold, fontSize: 14)),
                      Text("Status: $status", style: TextStyle(color: status == 'success' ? Colors.green : Colors.red, fontWeight: FontWeight.bold, fontSize: 12)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.black,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: SelectableText(
                      output,
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.white70),
                    ),
                  )
                ],
              ),
            ),
          );
        }
        
        // System, raw, or out messages
        String textToDisplay = '';
        Color textColor = Colors.white54;
        if (msg['type'] == 'system') {
          textToDisplay = msg['text'];
          textColor = Colors.cyanAccent.withOpacity(0.8);
        } else if (msg['type'] == 'raw') {
          textToDisplay = '[${msg['topic']}]: ${msg['text']}';
        } else if (msg['type'] == 'out') {
          textToDisplay = '[OUT → ${msg['topic']}]: ${msg['payload']}';
          textColor = Colors.orangeAccent.withOpacity(0.7);
        }

        return Card(
          margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
          child: Padding(
            padding: const EdgeInsets.all(10.0),
            child: Text(
              textToDisplay,
              style: TextStyle(fontFamily: 'monospace', fontSize: 11, color: textColor),
            ),
          ),
        );
      },
    );
  }
}
