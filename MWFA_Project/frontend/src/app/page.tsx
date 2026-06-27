'use client';
import { useEffect, useState } from 'react';

type Network = {
  id: number;
  ssid: string;
  bssid: string;
  createdAt: string;
  _count?: { devices: number };
};

type Device = {
  id: number;
  macAddress: string;
  ipAddress: string | null;
  network?: Network;
  createdAt: string;
};

type ScanResult = {
  id: number;
  deviceId: number;
  scanType: string;
  status: string;
  openPorts: string;
  rawOutput: string;
  scannedAt: string;
  device?: Device;
};

export default function Dashboard() {
  const [networks, setNetworks] = useState<Network[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanningDeviceId, setScanningDeviceId] = useState<number | null>(null);

  // Custom Scan State
  const [customTarget, setCustomTarget] = useState("");
  const [customPorts, setCustomPorts] = useState("");
  const [scanProfile, setScanProfile] = useState("fast");
  const [customScanning, setCustomScanning] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // We use the production railway URL here so it actually talks to the deployed backend
        const baseUrl = 'https://new-production-c82b.up.railway.app';
        const [netRes, devRes, scanRes] = await Promise.all([
          fetch(`${baseUrl}/api/networks`),
          fetch(`${baseUrl}/api/devices`),
          fetch(`${baseUrl}/api/scans`)
        ]);
        
        const netData = await netRes.json();
        const devData = await devRes.json();
        const scanData = await scanRes.json();
        
        setNetworks(netData);
        setDevices(devData);
        setScanResults(scanData);
      } catch (err) {
        console.error("Error fetching data", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Refresh every 5 seconds for quicker scan result updates
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleTriggerScan = async (deviceId: number, ip: string | null) => {
    if (!ip) return alert("Device has no IP address to scan.");
    
    setScanningDeviceId(deviceId);
    try {
        const baseUrl = 'https://new-production-c82b.up.railway.app';
        const res = await fetch(`${baseUrl}/api/scans/trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId, ports: [80, 443, 22, 21, 8080, 445, 3389] })
        });
        
        const data = await res.json();
        if (!res.ok) {
            alert(`Error triggering scan: ${data.error}`);
        }
    } catch (err) {
        console.error("Failed to trigger scan", err);
        alert("Failed to trigger scan");
    } finally {
        setScanningDeviceId(null);
    }
  };

  const handleCustomScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTarget) return alert("Please enter a target IP or Domain");

    setCustomScanning(true);
    try {
        const baseUrl = 'https://new-production-c82b.up.railway.app';
        const res = await fetch(`${baseUrl}/api/scans/custom`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                target: customTarget, 
                scanProfile, 
                ports: customPorts 
            })
        });
        
        const data = await res.json();
        if (!res.ok) {
            alert(`Error starting scan: ${data.error}`);
        } else {
            setCustomTarget(""); // clear target on success
        }
    } catch (err) {
        console.error("Failed to trigger custom scan", err);
        alert("Failed to trigger custom scan");
    } finally {
        setCustomScanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8 font-sans">
      <header className="mb-10 flex items-center justify-between border-b border-neutral-800 pb-6">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white mb-2">
            MWFA <span className="text-emerald-500">Dashboard</span>
          </h1>
          <p className="text-neutral-400">Mobile Wireless Forensic Auditor - Monitoring Hub</p>
        </div>
        <div className="flex items-center space-x-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <span className="text-sm font-medium text-emerald-500">System Active</span>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          
          {/* Advanced Cloud Scanner Panel */}
          <section className="bg-neutral-900/50 backdrop-blur-xl border border-indigo-500/30 rounded-2xl p-8 shadow-[0_0_40px_rgba(79,70,229,0.1)] xl:col-span-2 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
            
            <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
              <div>
                <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 flex items-center gap-3">
                  <span className="text-indigo-400">⚡</span> Advanced Cloud Scanner
                </h2>
                <p className="text-neutral-400 mt-2 text-sm">Target any Public IP or Domain. Powered by Railway Kali-MCP.</p>
              </div>
            </div>

            <form onSubmit={handleCustomScan} className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-4">
                <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Target (IP / Domain)</label>
                <input 
                  type="text" 
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                  placeholder="e.g. scanme.nmap.org or 8.8.8.8" 
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  required
                />
              </div>
              
              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Ports (Optional)</label>
                <input 
                  type="text" 
                  value={customPorts}
                  onChange={(e) => setCustomPorts(e.target.value)}
                  placeholder="e.g. 80,443 or 1-1000" 
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Scan Profile</label>
                <select 
                  value={scanProfile}
                  onChange={(e) => setScanProfile(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-sm text-neutral-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
                >
                  <option value="fast">🚀 Fast Scan (Top 100)</option>
                  <option value="os">💻 OS & Service Detection</option>
                  <option value="vuln">🛡️ Vulnerability Scan</option>
                  <option value="full">🔍 Full Port Scan (65k)</option>
                </select>
              </div>

              <div className="md:col-span-2 flex items-end">
                <button 
                  type="submit"
                  disabled={customScanning || !customTarget}
                  className={`w-full h-[46px] rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                    customScanning 
                    ? 'bg-indigo-900/50 text-indigo-400 cursor-wait border border-indigo-500/30' 
                    : !customTarget
                    ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-[0_0_20px_rgba(79,70,229,0.4)]'
                  }`}
                >
                  {customScanning ? (
                    <>
                      <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
                      Scanning...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                      Launch Scan
                    </>
                  )}
                </button>
              </div>
            </form>
          </section>

          {/* Local Hardware Grouping */}
          <div className="xl:col-span-2 mt-8 mb-4">
            <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400 flex items-center gap-3 border-b border-neutral-800 pb-4">
              <span className="text-emerald-400">🔌</span> Local Hardware & Devices
            </h2>
            <p className="text-neutral-400 mt-2 text-sm">Devices and Networks discovered by your T-Embed hardware locally.</p>
          </div>

          {/* Networks Panel */}
          <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                📡 Discovered Networks
              </h2>
              <span className="bg-neutral-800 text-neutral-300 py-1 px-3 rounded-full text-xs font-semibold">
                {networks.length} Total
              </span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-neutral-400 uppercase bg-neutral-950/50">
                  <tr>
                    <th className="px-4 py-3 rounded-tl-lg">SSID</th>
                    <th className="px-4 py-3">BSSID (MAC)</th>
                    <th className="px-4 py-3">Devices</th>
                    <th className="px-4 py-3 rounded-tr-lg">First Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {networks.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-neutral-500">No networks logged yet.</td></tr>
                  ) : (
                    networks.map(net => (
                      <tr key={net.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-emerald-400">{net.ssid || 'Hidden'}</td>
                        <td className="px-4 py-3 font-mono text-neutral-300">{net.bssid}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="bg-emerald-500/10 text-emerald-400 py-1 px-2 rounded font-bold text-xs">
                            {net._count?.devices || 0}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-neutral-500">
                          {new Date(net.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Devices Panel */}
          <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                📱 Logged Devices
              </h2>
              <span className="bg-neutral-800 text-neutral-300 py-1 px-3 rounded-full text-xs font-semibold">
                {devices.length} Total
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-neutral-400 uppercase bg-neutral-950/50">
                  <tr>
                    <th className="px-4 py-3 rounded-tl-lg">MAC Address</th>
                    <th className="px-4 py-3">IP Address</th>
                    <th className="px-4 py-3">Associated Network</th>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3 rounded-tr-lg text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-neutral-500">No devices logged yet.</td></tr>
                  ) : (
                    devices.map(dev => (
                      <tr key={dev.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors">
                        <td className="px-4 py-3 font-mono font-medium text-neutral-200">{dev.macAddress}</td>
                        <td className="px-4 py-3 font-mono text-emerald-400">
                          {dev.ipAddress ? dev.ipAddress : <span className="text-neutral-600">N/A</span>}
                        </td>
                        <td className="px-4 py-3 text-neutral-300">
                          {dev.network?.ssid ? dev.network.ssid : <span className="text-neutral-600">Unknown</span>}
                        </td>
                        <td className="px-4 py-3 text-neutral-500">
                          {new Date(dev.createdAt).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleTriggerScan(dev.id, dev.ipAddress)}
                            disabled={!dev.ipAddress || scanningDeviceId === dev.id}
                            className={`px-3 py-1 text-xs font-bold rounded flex items-center justify-center gap-1 ml-auto transition-colors ${
                                !dev.ipAddress 
                                ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed' 
                                : scanningDeviceId === dev.id
                                ? 'bg-emerald-900 text-emerald-400 cursor-wait'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                            }`}
                          >
                            {scanningDeviceId === dev.id ? (
                                <>
                                  <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
                                  Sending
                                </>
                            ) : (
                                "▶ Scan IP"
                            )}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Scan Results Panel */}
          <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-2xl lg:col-span-2">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                🛡️ Reverse Scan Results
              </h2>
              <span className="bg-neutral-800 text-neutral-300 py-1 px-3 rounded-full text-xs font-semibold">
                {scanResults.length} Logs
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-neutral-400 uppercase bg-neutral-950/50">
                  <tr>
                    <th className="px-4 py-3 rounded-tl-lg">Target IP</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Open Ports</th>
                    <th className="px-4 py-3 rounded-tr-lg">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {scanResults.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-neutral-500">No scans executed yet.</td></tr>
                  ) : (
                    scanResults.map(scan => (
                      <tr key={scan.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-emerald-400 font-medium">
                            {scan.device?.ipAddress || 'Unknown IP'}
                        </td>
                        <td className="px-4 py-3">
                            {scan.status === 'running' ? (
                                <span className="bg-yellow-500/10 text-yellow-500 py-1 px-2 rounded font-bold text-xs flex items-center gap-2 w-max">
                                    <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></div>
                                    Scanning...
                                </span>
                            ) : (
                                <span className="bg-emerald-500/10 text-emerald-500 py-1 px-2 rounded font-bold text-xs flex items-center gap-2 w-max">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                    Done
                                </span>
                            )}
                        </td>
                        <td className="px-4 py-3 font-mono text-neutral-300">
                          {scan.status === 'running' ? (
                            <span className="text-neutral-500">Scanning via Cloud MCP...</span>
                          ) : (
                            JSON.parse(scan.openPorts || '[]').length > 0 ? (
                              <span className="text-red-400 font-bold">{JSON.parse(scan.openPorts).join(', ')}</span>
                            ) : (
                              <span className="text-neutral-500">No open ports</span>
                            )
                          )}
                        </td>
                        <td className="px-4 py-3 text-neutral-500">
                          {new Date(scan.scannedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

        </div>
      )}
    </div>
  );
}
