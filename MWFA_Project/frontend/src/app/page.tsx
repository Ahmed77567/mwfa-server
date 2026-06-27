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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
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
                            <span className="text-neutral-500">Waiting for hardware...</span>
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
