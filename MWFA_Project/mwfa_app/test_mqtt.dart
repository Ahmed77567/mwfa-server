import 'dart:io';
import 'package:mqtt_client/mqtt_client.dart';
import 'package:mqtt_client/mqtt_server_client.dart';

void main() async {
  final broker = '3f5f4470310e4cddaae686f16146fdc8.s1.eu.hivemq.cloud';
  final port = 8883;
  final clientIdentifier = 'test_app_123';
  
  final client = MqttServerClient.withPort(broker, clientIdentifier, port);
  client.secure = true;
  client.setProtocolV311();
  client.keepAlivePeriod = 60;
  client.logging(on: true);
  client.onBadCertificate = (dynamic cert) => true;

  final MqttConnectMessage connMess = MqttConnectMessage()
      .withClientIdentifier(clientIdentifier)
      .authenticateAs('ahmed_mwfa', '7XP@un@VYvdPjwS')
      .startClean();
  
  client.connectionMessage = connMess;

  try {
    print('Connecting...');
    await client.connect();
  } catch (e) {
    print('Exception: $e');
    client.disconnect();
    return;
  }

  if (client.connectionStatus!.state == MqttConnectionState.connected) {
    print('Connected successfully!');
    client.disconnect();
  } else {
    print('Failed to connect, state: ${client.connectionStatus!.state}');
  }
  exit(0);
}
