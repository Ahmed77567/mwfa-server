import paho.mqtt.client as mqtt
import subprocess
import json
import uuid
import time
import os
import threading
from collections import defaultdict

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  MQTT Config
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MQTT_BROKER = "3f5f4470310e4cddaae686f16146fdc8.s1.eu.hivemq.cloud"
MQTT_PORT = 8883
MQTT_USER = "ahmed_mwfa"
MQTT_PASS = "7XP@un@VYvdPjwS"

# Agent & Device IDs
KALI_ID = "kali01"
TEMBED_ID = os.environ.get("TEMBED_ID", "tembed01")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Topics
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KALI_COMMAND_TOPIC   = f"mwfa/commands/{KALI_ID}"
KALI_STATUS_TOPIC    = f"mwfa/{KALI_ID}/status"
TEMBED_COMMAND_TOPIC = f"mwfa/commands/{TEMBED_ID}"
PROXY_STATUS_TOPIC   = f"mwfa/{TEMBED_ID}/proxy_status"
TCP_RESULT_TOPIC     = f"mwfa/{TEMBED_ID}/tcp_result"

# Legacy topics (backward compatible)
RAW_DATA_TOPIC       = f"mwfa/data/raw_{TEMBED_ID}"
RESULT_TOPIC         = f"mwfa/results/nmap_{TEMBED_ID}"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Port Scan Profiles
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCAN_PROFILES = {
    "fast": [
        21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445,
        993, 995, 1723, 3306, 3389, 5900, 8080, 8443
    ],
    "default": [
        1, 3, 7, 9, 13, 17, 19, 21, 22, 23, 25, 26, 37, 53, 79, 80, 81, 88,
        106, 110, 111, 113, 119, 135, 139, 143, 144, 179, 199, 389, 427, 443,
        444, 445, 465, 513, 514, 515, 543, 544, 548, 554, 587, 631, 646, 873,
        990, 993, 995, 1025, 1026, 1027, 1028, 1029, 1110, 1433, 1720, 1723,
        1755, 1900, 2000, 2001, 2049, 2121, 2717, 3000, 3128, 3306, 3389,
        3986, 4899, 5000, 5009, 5051, 5060, 5101, 5190, 5357, 5432, 5631,
        5666, 5800, 5900, 6000, 6001, 6646, 7070, 8000, 8008, 8080, 8443,
        8888, 9100, 9999, 10000, 32768, 49152, 49153, 49154, 49155, 49156
    ],
    "top100": list(range(1, 101)),
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Global State
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
proxy_ready = False
proxy_network_info = {}
tcp_results = {}       # { (ip, port): result_dict }
result_events = {}     # { (ip, port): threading.Event }
active_task_id = None

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Legacy: Direct Nmap scan (for public targets)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def run_nmap(target, flags):
    print(f"[*] Running Nmap on {target} with flags: {flags}")
    try:
        cmd = ["nmap"] + flags.split() + [target]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        return {
            "status": "success",
            "output": result.stdout,
            "error": result.stderr if result.returncode != 0 else None
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Proxy Scan Orchestrator
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def handle_proxy_scan(client, payload):
    """
    Orchestrates a deep scan through the T-Embed agent:
    1. Verifies T-Embed is ready (proxy_status: ready)
    2. Sends tcp_probe commands for each target:port
    3. Collects results from tcp_result MQTT topic
    4. Builds nmap-style report and publishes it
    """
    global active_task_id, proxy_ready

    targets = payload.get("targets", [])
    profile = payload.get("scanProfile", "fast")
    task_id = payload.get("task_id", f"pscan_{int(time.time())}")
    tembed_id = payload.get("tembedId", TEMBED_ID)

    active_task_id = task_id
    custom_ports_str = payload.get("customPorts", "")

    active_task_id = task_id
    
    if profile == "custom" and custom_ports_str:
        ports = []
        for part in custom_ports_str.split(','):
            part = part.strip()
            if not part: continue
            if '-' in part:
                try:
                    start, end = map(int, part.split('-'))
                    ports.extend(range(start, end + 1))
                except ValueError:
                    pass
            else:
                try:
                    ports.append(int(part))
                except ValueError:
                    pass
        # Remove duplicates and sort
        ports = sorted(list(set(ports)))
        if not ports:
            ports = SCAN_PROFILES["fast"] # fallback
    else:
        ports = SCAN_PROFILES.get(profile, SCAN_PROFILES["fast"])

    print(f"\n{'='*60}")
    print(f"[PROXY SCAN] Task: {task_id}")
    print(f"[PROXY SCAN] Targets: {targets}")
    print(f"[PROXY SCAN] Profile: {profile} ({len(ports)} ports)")
    print(f"{'='*60}")

    if not proxy_ready:
        print("[!] T-Embed proxy not ready — sending establish_proxy command...")
        client.publish(
            f"mwfa/commands/{tembed_id}",
            json.dumps({"command": "establish_proxy"}),
            qos=1
        )
        # Wait for proxy to be ready (max 15 seconds)
        for i in range(30):
            if proxy_ready:
                break
            time.sleep(0.5)
        
        if not proxy_ready:
            print("[-] ERROR: T-Embed proxy did not become ready in 15 seconds")
            _publish_scan_error(client, task_id, targets, "T-Embed proxy not ready")
            return

    print(f"[+] T-Embed proxy is READY. Starting scan...")

    all_results = {}

    for target in targets:
        print(f"\n[*] Scanning {target} ({len(ports)} ports)...")
        all_results[target] = []

        for port in ports:
            key = (target, port)
            event = threading.Event()
            result_events[key] = event

            # Send tcp_probe command to T-Embed
            probe_cmd = {
                "command": "tcp_probe",
                "ip": target,
                "port": port,
                "task_id": task_id
            }
            client.publish(
                f"mwfa/commands/{tembed_id}",
                json.dumps(probe_cmd),
                qos=1
            )

            # Wait for result (timeout 6 seconds — slightly more than T-Embed's 3s probe timeout)
            got_result = event.wait(timeout=6.0)

            if got_result and key in tcp_results:
                result = tcp_results.pop(key)
                all_results[target].append(result)
                state_icon = "✅" if result.get("state") == "open" else "❌"
                if result.get("state") == "open":
                    banner_info = f" [{result.get('banner', '')[:40]}]" if result.get("banner") else ""
                    print(f"  {state_icon} {target}:{port} → {result.get('state')} ({result.get('ms', '?')}ms){banner_info}")
            else:
                # Timeout — assume filtered
                all_results[target].append({
                    "ip": target, "port": port,
                    "state": "filtered", "ms": 0
                })

            # Clean up
            result_events.pop(key, None)

    # ── Build nmap-style report ───────────────────────────────────────────
    report = build_nmap_report(all_results)
    print(f"\n{'='*60}")
    print(report)
    print(f"{'='*60}")

    # ── Publish complete report ───────────────────────────────────────────
    report_payload = {
        "task_id": task_id,
        "targets": targets,
        "profile": profile,
        "results": all_results,
        "report": report,
        "timestamp": time.time()
    }
    client.publish(
        f"mwfa/results/proxy_scan/{task_id}",
        json.dumps(report_payload),
        qos=1
    )
    print(f"[+] Report published to mwfa/results/proxy_scan/{task_id}")

    active_task_id = None


def _publish_scan_error(client, task_id, targets, error_msg):
    """Publish an error report when scan fails to start."""
    client.publish(
        f"mwfa/results/proxy_scan/{task_id}",
        json.dumps({
            "task_id": task_id,
            "targets": targets,
            "status": "error",
            "error": error_msg,
            "timestamp": time.time()
        }),
        qos=1
    )


def build_nmap_report(all_results):
    """Build an nmap-style text report from collected TCP probe results."""
    lines = []
    lines.append(f"MWFA Deep Scan Report via T-Embed Proxy")
    lines.append(f"Generated at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"{'='*60}")

    for target, results in all_results.items():
        lines.append(f"\nScan report for {target}")

        open_ports = [r for r in results if r.get("state") == "open"]
        closed_ports = [r for r in results if r.get("state") == "closed"]
        filtered_ports = [r for r in results if r.get("state") == "filtered"]

        lines.append(f"Not shown: {len(closed_ports)} closed, {len(filtered_ports)} filtered ports")
        lines.append(f"{'PORT':<12}{'STATE':<12}{'SERVICE':<20}{'BANNER'}")
        lines.append("-" * 60)

        for r in sorted(open_ports, key=lambda x: x.get("port", 0)):
            port_str = f"{r.get('port', '?')}/tcp"
            state = r.get("state", "unknown")
            service = _guess_service(r.get("port", 0), r.get("banner", ""))
            banner = (r.get("banner", "") or "")[:40]
            lines.append(f"{port_str:<12}{state:<12}{service:<20}{banner}")

        total = len(results)
        lines.append(f"\n{len(open_ports)} open, {len(closed_ports)} closed, {len(filtered_ports)} filtered ({total} scanned)")

    lines.append(f"\n{'='*60}")
    lines.append("Scan completed.")
    return "\n".join(lines)


def _guess_service(port, banner=""):
    """Guess service name from port number and banner."""
    banner_lower = (banner or "").lower()
    
    # Banner-based detection
    if "ssh" in banner_lower:
        return "ssh"
    if "http" in banner_lower or "html" in banner_lower:
        return "http"
    if "ftp" in banner_lower:
        return "ftp"
    if "smtp" in banner_lower or "mail" in banner_lower:
        return "smtp"
    if "mysql" in banner_lower or "mariadb" in banner_lower:
        return "mysql"
    if "postgresql" in banner_lower:
        return "postgresql"
    
    # Port-based fallback
    SERVICE_MAP = {
        21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
        80: "http", 110: "pop3", 111: "rpcbind", 135: "msrpc",
        139: "netbios-ssn", 143: "imap", 443: "https", 445: "microsoft-ds",
        993: "imaps", 995: "pop3s", 1433: "ms-sql-s", 1723: "pptp",
        3306: "mysql", 3389: "ms-wbt-server", 5432: "postgresql",
        5900: "vnc", 8080: "http-proxy", 8443: "https-alt",
        8888: "sun-answerbook", 9100: "jetdirect",
    }
    return SERVICE_MAP.get(port, "unknown")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  MQTT Callbacks
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[+] Connected to MQTT Broker!")
        # Publish online status
        client.publish(KALI_STATUS_TOPIC, json.dumps({"status": "online"}), qos=1, retain=True)
        
        # Subscribe to all relevant topics
        topics = [
            (KALI_COMMAND_TOPIC, 1),
            (RAW_DATA_TOPIC, 1),
            (PROXY_STATUS_TOPIC, 1),
            (TCP_RESULT_TOPIC, 1),
            (f"mwfa/commands/{TEMBED_ID}", 1),  # Listen for commands too
        ]
        client.subscribe(topics)
        for t, _ in topics:
            print(f"[*] Subscribed to {t}")
    else:
        print(f"[-] Failed to connect, return code {rc}")


def on_message(client, userdata, msg):
    global proxy_ready, proxy_network_info

    topic = msg.topic
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except json.JSONDecodeError:
        print(f"[-] Invalid JSON on {topic}")
        return

    # ── Handle Proxy Status from T-Embed ──────────────────────────────────
    if topic == PROXY_STATUS_TOPIC:
        status = payload.get("status", "unknown")
        print(f"[PROXY] T-Embed proxy status: {status}")
        
        if status == "ready":
            proxy_ready = True
            proxy_network_info = {
                "localIp": payload.get("localIp"),
                "gateway": payload.get("gateway"),
                "subnet": payload.get("subnet"),
                "ssid": payload.get("ssid"),
            }
            print(f"[PROXY] Network info: {json.dumps(proxy_network_info, indent=2)}")
        elif status == "stopped":
            proxy_ready = False
            proxy_network_info = {}
        return

    # ── Handle TCP Probe Results from T-Embed ─────────────────────────────
    if topic == TCP_RESULT_TOPIC:
        ip = payload.get("ip", "")
        port = payload.get("port", 0)
        
        # Check if this is a scan_complete event
        if payload.get("event") == "scan_complete":
            print(f"[TCP] Scan complete for {ip}: {payload.get('openCount', 0)}/{payload.get('total', 0)} open")
            return

        key = (ip, port)
        tcp_results[key] = payload

        # Signal the waiting thread
        if key in result_events:
            result_events[key].set()
        return

    # ── Handle Commands for Kali ──────────────────────────────────────────
    if topic == KALI_COMMAND_TOPIC:
        command = payload.get("command", "")
        print(f"\n[CMD] Received command: {command}")

        if command == "scan":
            # Legacy: direct nmap scan (public targets only)
            target = payload.get("target")
            flags = payload.get("flags", "-F")
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

        elif command == "proxy_scan":
            # Deep scan through T-Embed proxy
            scan_thread = threading.Thread(
                target=handle_proxy_scan,
                args=(client, payload),
                daemon=True
            )
            scan_thread.start()
        return

    # ── Handle Raw Data (legacy) ──────────────────────────────────────────
    if topic == RAW_DATA_TOPIC:
        if "ip" in payload:
            target_ip = payload["ip"]
            print(f"[*] Detected IP from raw data: {target_ip}. Starting scan...")
            result = run_nmap(target_ip, "-F -T4")
            pub_payload = {
                "task_id": str(uuid.uuid4()),
                "target": target_ip,
                "timestamp": time.time(),
                "result": result
            }
            client.publish(RESULT_TOPIC, json.dumps(pub_payload))
            print(f"[+] Scan result published to {RESULT_TOPIC}")
        return


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Main
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if __name__ == "__main__":
    print("=" * 60)
    print("  MWFA Kali Agent — Proxy Scan Orchestrator")
    print(f"  Kali ID:   {KALI_ID}")
    print(f"  T-Embed:   {TEMBED_ID}")
    print(f"  Broker:    {MQTT_BROKER}:{MQTT_PORT}")
    print("=" * 60)

    client = mqtt.Client()
    client.username_pw_set(MQTT_USER, MQTT_PASS)
    client.tls_set()  # Required for HiveMQ Cloud

    # Set Last Will and Testament (LWT) for offline status
    client.will_set(KALI_STATUS_TOPIC, json.dumps({"status": "offline"}), qos=1, retain=True)

    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 15)
        client.loop_forever()
    except KeyboardInterrupt:
        print("\n[*] Shutting down gracefully...")
        # Publish offline status explicitly because graceful disconnect cancels the LWT
        client.publish(KALI_STATUS_TOPIC, json.dumps({"status": "offline"}), qos=1, retain=True)
        # Process the publish message before disconnecting
        client.loop() 
        client.disconnect()
    except Exception as e:
        print(f"[-] Fatal error: {e}")
