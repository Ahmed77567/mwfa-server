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
        scaffoldBackgroundColor: const Color(0xFF121212),
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

class _DashboardScreenState extends State<DashboardScreen> {
  final String broker = '3f5f4470310e4cddaae686f16146fdc8.s1.eu.hivemq.cloud';
  final int port = 8883;
  final String clientIdentifier = 'flutter_client_${DateTime.now().millisecondsSinceEpoch}';
  
  MqttServerClient? client;
  String connectionStatus = 'Disconnected';
  List<String> messages = [];

  @override
  void initState() {
    super.initState();
    if (kIsWeb) {
      setState(() {
        connectionStatus = 'Error: Web not supported for raw TCP MQTT. Please run on Windows/Android.';
        messages.add('Chrome/Web testing does not support standard MQTT over TCP (requires WebSockets). Please stop this and run: flutter run -d windows');
      });
    } else {
      _connectMQTT();
    }
  }

  Future<void> _connectMQTT() async {
    setState(() => connectionStatus = 'Connecting...');
    
    try {
      client = MqttServerClient.withPort(broker, clientIdentifier, port);
      client!.secure = true;
      client!.setProtocolV311();
      client!.keepAlivePeriod = 60;
      
      // Bypass cert validation for testing
      client!.onBadCertificate = (X509Certificate cert) => true;

      final MqttConnectMessage connMess = MqttConnectMessage()
          .withClientIdentifier(clientIdentifier)
          .authenticateAs('ahmed_mwfa', '7XP@un@VYvdPjwS')
          .withWillQos(MqttQos.atLeastOnce);
      
      client!.connectionMessage = connMess;

      await client!.connect();
    } catch (e) {
      setState(() => connectionStatus = 'Error: $e');
      client?.disconnect();
      return;
    }

    if (client!.connectionStatus!.state == MqttConnectionState.connected) {
      setState(() => connectionStatus = 'Connected to HiveMQ');
      
      // Subscriptions
      client!.subscribe('mwfa/results/#', MqttQos.atLeastOnce);
      client!.subscribe('mwfa/data/#', MqttQos.atLeastOnce);

      client!.updates!.listen((List<MqttReceivedMessage<MqttMessage>> c) {
        final MqttPublishMessage recMess = c[0].payload as MqttPublishMessage;
        final String pt = MqttPublishPayload.bytesToStringAsString(recMess.payload.message);
        
        setState(() {
          messages.insert(0, '[${c[0].topic}]: $pt');
        });
      });
    } else {
      setState(() => connectionStatus = 'Failed to connect');
      client!.disconnect();
    }
  }

  void _triggerScan() {
    if (client != null && client!.connectionStatus?.state == MqttConnectionState.connected) {
      final builder = MqttClientPayloadBuilder();
      final payload = jsonEncode({
        "command": "scan",
        "target": "scanme.nmap.org",
        "flags": "-F"
      });
      builder.addString(payload);
      client!.publishMessage('mwfa/commands/device01', MqttQos.atLeastOnce, builder.payload!);
      
      setState(() {
        messages.insert(0, '[OUT -> mwfa/commands/device01]: $payload');
      });
    } else {
      setState(() {
        messages.insert(0, 'Cannot send command: MQTT is not connected.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('MWFA Relay Dashboard'),
        actions: [
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Center(child: Text(connectionStatus)),
          )
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                ElevatedButton.icon(
                  onPressed: _triggerScan,
                  icon: const Icon(Icons.radar),
                  label: const Text('Trigger Fast Scan'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.deepPurpleAccent,
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 15),
                  ),
                ),
              ],
            ),
          ),
          const Divider(color: Colors.white24),
          Expanded(
            child: ListView.builder(
              itemCount: messages.length,
              itemBuilder: (context, index) {
                return Card(
                  color: const Color(0xFF1E1E1E),
                  margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  child: Padding(
                    padding: const EdgeInsets.all(12.0),
                    child: Text(
                      messages[index],
                      style: TextStyle(
                        fontFamily: 'monospace', 
                        fontSize: 12, 
                        color: messages[index].contains('Error') || messages[index].contains('Cannot') ? Colors.redAccent : Colors.white
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
