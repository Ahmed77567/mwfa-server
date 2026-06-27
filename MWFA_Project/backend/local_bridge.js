const mqtt = require('mqtt');
const fs = require('fs');

console.log("==================================================");
console.log("🚀 MWFA Local Bridge — Connecting Railway to Local MCP");
console.log("==================================================");

// HiveMQ Credentials (same as backend & T-Embed)
const MQTT_HOST = 'mqtts://3f5f4470310e4cddaae686f16146fdc8.s1.eu.hivemq.cloud:8883';
const MQTT_OPTIONS = {
  username: 'ahmed_mwfa',
  password: '7XP@un@VYvdPjwS',
  clientId: 'local_bridge_' + Math.random().toString(16).substring(2, 8)
};

const MCP_URL = 'http://localhost:8000';

console.log(`[1] Connecting to HiveMQ MQTT Broker...`);
const client = mqtt.connect(MQTT_HOST, MQTT_OPTIONS);

client.on('connect', () => {
    console.log(`[✓] Connected to MQTT Broker successfully!`);
    
    // Subscribe to commands intended for any device (or the relay)
    client.subscribe('mwfa/+/cmd', (err) => {
        if (!err) {
            console.log(`[✓] Listening for Scan Commands from Railway Backend...`);
        } else {
            console.error(`[X] Failed to subscribe:`, err);
        }
    });
});

client.on('message', async (topic, message) => {
    console.log(`\n[📥] Received Command on topic: ${topic}`);
    const deviceId = topic.split('/')[1]; // Extract tembed01
    
    try {
        const payload = JSON.parse(message.toString());
        console.log(`[Command Details]:`, payload);
        
        if (payload.command === 'port_scan') {
            console.log(`\n[⚡] Executing Nmap scan via LOCAL MCP on: ${payload.target}...`);
            
            // 1. Send Request to Local MCP
            const mcpPayload = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: { 
                    name: 'nmap', 
                    arguments: { 
                        target: payload.target, 
                        flags: '-sV -T4 --top-ports 100' 
                    } 
                }
            };
            
            const mcpRes = await fetch(`${MCP_URL}/mcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mcpPayload)
            });
            
            if (!mcpRes.ok) {
                throw new Error(`MCP returned ${mcpRes.status}`);
            }
            
            const mcpResult = await mcpRes.json();
            console.log(`[✓] Local MCP scan completed.`);
            
            // 2. Parse Open Ports from MCP Output
            let nmapOutput = "";
            if (mcpResult.result && mcpResult.result.content) {
                nmapOutput = mcpResult.result.content.map(c => c.text).join('\n');
            }
            
            const openPorts = [];
            const lines = nmapOutput.split('\n');
            for (const line of lines) {
                if (line.includes('/tcp') && line.includes('open')) {
                    const portMatch = line.match(/^(\d+)\/tcp/);
                    if (portMatch) openPorts.push(parseInt(portMatch[1]));
                }
            }
            
            console.log(`[🔍] Found open ports:`, openPorts);
            
            // 3. Send Result Back to Railway via MQTT
            const resultTopic = `mwfa/${deviceId}/scan_result`;
            const resultPayload = {
                target: payload.target,
                openPorts: openPorts
            };
            
            client.publish(resultTopic, JSON.stringify(resultPayload), { qos: 1 });
            console.log(`[📤] Results sent back to Railway Backend! (Topic: ${resultTopic})`);
        }
        
    } catch (err) {
        console.error(`[X] Error processing command:`, err.message);
    }
});

client.on('error', (err) => {
    console.error(`[X] MQTT Error:`, err.message);
});
