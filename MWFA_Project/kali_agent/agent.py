import paho.mqtt.client as mqtt
import subprocess
import json
import uuid
import time
import os

# MQTT Config
MQTT_BROKER = "3f5f4470310e4cddaae686f16146fdc8.s1.eu.hivemq.cloud"
MQTT_PORT = 8883
MQTT_USER = "ahmed_mwfa"
MQTT_PASS = "7XP@un@VYvdPjwS"
DEVICE_ID = "device01"

# Topics
COMMAND_TOPIC = f"mwfa/commands/{DEVICE_ID}"
RAW_DATA_TOPIC = f"mwfa/data/raw_{DEVICE_ID}"
RESULT_TOPIC = f"mwfa/results/nmap_{DEVICE_ID}"

def run_nmap(target, flags):
    print(f"[*] Running Nmap on {target} with flags: {flags}")
    try:
        # Example: nmap -sV -T4 <target>
        cmd = ["nmap"] + flags.split() + [target]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        return {
            "status": "success",
            "output": result.stdout,
            "error": result.stderr if result.returncode != 0 else None
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[+] Connected to MQTT Broker!")
        # Listen for raw data or direct commands
        client.subscribe(RAW_DATA_TOPIC)
        client.subscribe(COMMAND_TOPIC)
        print(f"[*] Subscribed to {RAW_DATA_TOPIC}")
        print(f"[*] Subscribed to {COMMAND_TOPIC}")
    else:
        print(f"[-] Failed to connect, return code {rc}")

def on_message(client, userdata, msg):
    print(f"\n[+] Message received on {msg.topic}")
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
        print(f"Payload: {json.dumps(payload, indent=2)}")

        # Handle Raw Data (e.g., from T-Embed Sniffing)
        if msg.topic == RAW_DATA_TOPIC:
            if "ip" in payload:
                target_ip = payload["ip"]
                print(f"[*] Detected IP from raw data: {target_ip}. Starting scan...")
                # Run a default quick scan
                result = run_nmap(target_ip, "-F -T4")
                
                # Publish result
                pub_payload = {
                    "task_id": str(uuid.uuid4()),
                    "target": target_ip,
                    "timestamp": time.time(),
                    "result": result
                }
                client.publish(RESULT_TOPIC, json.dumps(pub_payload))
                print(f"[+] Scan result published to {RESULT_TOPIC}")

        # Handle Explicit Commands (e.g., from Flutter App)
        elif msg.topic == COMMAND_TOPIC:
            if payload.get("command") == "scan":
                target = payload.get("target")
                flags = payload.get("flags", "-F") # Default to fast scan
                
                if target:
                    result = run_nmap(target, flags)
                    pub_payload = {
                        "task_id": payload.get("task_id", str(uuid.uuid4())),
                        "target": target,
                        "timestamp": time.time(),
                        "result": result
                    }
                    client.publish(RESULT_TOPIC, json.dumps(pub_payload))
                    print(f"[+] Scan result published to {RESULT_TOPIC}")

    except json.JSONDecodeError:
        print("[-] Error: Payload is not valid JSON")
    except Exception as e:
        print(f"[-] Error processing message: {e}")

if __name__ == "__main__":
    print("[*] Starting Kali Agent...")
    client = mqtt.Client()
    client.username_pw_set(MQTT_USER, MQTT_PASS)
    client.tls_set() # Required for HiveMQ Cloud
    
    client.on_connect = on_connect
    client.on_message = on_message
    
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        client.loop_forever()
    except KeyboardInterrupt:
        print("\n[*] Shutting down...")
        client.disconnect()
    except Exception as e:
        print(f"[-] Fatal error: {e}")
