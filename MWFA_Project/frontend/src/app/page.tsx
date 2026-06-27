'use client';
import { useEffect, useState } from 'react';

// ─────────────────── Types ───────────────────
type Network = {
  id: number; ssid: string; bssid: string; createdAt: string;
  _count?: { devices: number };
};
type Device = {
  id: number; macAddress: string; ipAddress: string | null;
  network?: Network; createdAt: string;
};
type ScanResult = {
  id: number; deviceId: number; scanType: string; status: string;
  openPorts: string; rawOutput: string; scannedAt: string; device?: Device;
};

const BASE_URL = 'https://new-production-c82b.up.railway.app';

function parsePorts(raw: string): number[] {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

// ─────────────────── Status Badge ───────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; dot: string; label: string }> = {
    running: { cls: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30', dot: 'bg-yellow-400 animate-pulse', label: 'Scanning…' },
    done:    { cls: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30', dot: 'bg-emerald-400', label: 'Done' },
    failed:  { cls: 'bg-red-500/10 text-red-400 border border-red-500/30', dot: 'bg-red-400', label: 'Failed' },
    pending: { cls: 'bg-neutral-700/50 text-neutral-400 border border-neutral-700', dot: 'bg-neutral-400', label: 'Pending' },
  };
  const s = cfg[status] ?? cfg.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ─────────────────── Modal ───────────────────
function NmapModal({ scan, onClose }: { scan: ScanResult; onClose: () => void }) {
  const ports = parsePorts(scan.openPorts);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0d0d0d] border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-950">
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-widest mb-1">Nmap Results</p>
            <h3 className="text-lg font-bold text-white font-mono">{scan.device?.ipAddress ?? 'Unknown'}</h3>
          </div>
          <div className="flex items-center gap-4">
            <StatusBadge status={scan.status} />
            <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        {/* open ports summary */}
        {ports.length > 0 && (
          <div className="px-6 py-3 bg-red-950/20 border-b border-red-900/30 flex flex-wrap gap-2">
            {ports.map(p => (
              <span key={p} className="bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-xs font-mono font-bold">{p}/tcp</span>
            ))}
          </div>
        )}
        {/* raw */}
        <div className="flex-1 overflow-auto p-6 bg-black">
          <pre className="text-emerald-400 font-mono text-xs leading-relaxed whitespace-pre-wrap">{scan.rawOutput || 'No raw output available.'}</pre>
        </div>
        <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950 flex justify-end">
          <button onClick={onClose} className="bg-neutral-800 hover:bg-neutral-700 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Main Page ───────────────────
export default function Dashboard() {
  const [networks,    setNetworks]    = useState<Network[]>([]);
  const [devices,     setDevices]     = useState<Device[]>([]);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState<'cloud' | 'device'>('cloud');

  // Cloud scanner
  const [cloudTarget,   setCloudTarget]   = useState('');
  const [cloudPorts,    setCloudPorts]    = useState('');
  const [cloudProfile,  setCloudProfile]  = useState('fast');
  const [cloudScanning, setCloudScanning] = useState(false);
  const [cloudStatus,   setCloudStatus]   = useState<'idle' | 'ok' | 'error'>('idle');

  // Device scanner
  const [scanningId, setScanningId] = useState<number | null>(null);

  // Modal
  const [modalScan, setModalScan] = useState<ScanResult | null>(null);

  // ── Fetch ──
  useEffect(() => {
    const fetch_ = async () => {
      try {
        const [nr, dr, sr] = await Promise.all([
          fetch(`${BASE_URL}/api/networks`),
          fetch(`${BASE_URL}/api/devices`),
          fetch(`${BASE_URL}/api/scans`),
        ]);
        setNetworks(await nr.json());
        setDevices(await dr.json());
        setScanResults(await sr.json());
      } catch { /* ignore */ } finally { setLoading(false); }
    };
    fetch_();
    const t = setInterval(fetch_, 5000);
    return () => clearInterval(t);
  }, []);

  // ── Cloud Scan ──
  const handleCloudScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloudTarget) return;
    setCloudScanning(true); setCloudStatus('idle');
    try {
      const res = await fetch(`${BASE_URL}/api/scans/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: cloudTarget, scanProfile: cloudProfile, ports: cloudPorts }),
      });
      if (!res.ok) throw new Error();
      setCloudStatus('ok'); setCloudTarget('');
    } catch { setCloudStatus('error'); }
    finally { setCloudScanning(false); }
  };

  // ── Device Scan ──
  const handleDeviceScan = async (deviceId: number, ip: string | null) => {
    if (!ip) return alert('Device has no IP address.');
    setScanningId(deviceId);
    try {
      await fetch(`${BASE_URL}/api/scans/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
    } catch { alert('Failed to trigger scan'); }
    finally { setScanningId(null); }
  };

  const cloudScans  = scanResults.filter(s => s.device?.macAddress?.startsWith('CUSTOM-'));
  const deviceScans = scanResults.filter(s => !s.device?.macAddress?.startsWith('CUSTOM-'));

  return (
    <div className="min-h-screen bg-[#080808] text-neutral-100 font-sans">

      {/* ── NAV ── */}
      <nav className="border-b border-neutral-900 bg-[#0a0a0a] px-8 py-4 flex items-center justify-between sticky top-0 z-40 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-black text-sm">M</div>
          <span className="font-bold text-white text-lg tracking-tight">MWFA</span>
          <span className="text-neutral-600 text-sm ml-1">Security Dashboard</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-emerald-400 text-xs font-medium">Live</span>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* ── TAB SWITCHER ── */}
        <div className="flex gap-2 mb-8 p-1 bg-neutral-900 border border-neutral-800 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('cloud')}
            className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'cloud'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/20'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>
            Cloud Scanner
          </button>
          <button
            onClick={() => setActiveTab('device')}
            className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'device'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/20'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" /></svg>
            Device Monitor
          </button>
        </div>

        {/* ════════════════════════════════════
            CLOUD SCANNER TAB
            ════════════════════════════════════ */}
        {activeTab === 'cloud' && (
          <div className="space-y-6">
            {/* Scanner Card */}
            <div className="relative bg-neutral-900/60 backdrop-blur border border-indigo-500/20 rounded-2xl p-8 overflow-hidden">
              <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-20 -left-20 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10 mb-6">
                <h1 className="text-2xl font-extrabold text-white mb-1 flex items-center gap-2">
                  <span className="text-indigo-400">⚡</span> Advanced Cloud Scanner
                </h1>
                <p className="text-neutral-400 text-sm">Scan any public IP or domain via Railway Kali-MCP. Results appear below automatically.</p>
              </div>

              <form onSubmit={handleCloudScan} className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-4">
                  <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Target</label>
                  <input
                    type="text" value={cloudTarget}
                    onChange={e => setCloudTarget(e.target.value)}
                    placeholder="scanme.nmap.org or 8.8.8.8"
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder-neutral-600 outline-none transition-all"
                    required
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Ports (optional)</label>
                  <input
                    type="text" value={cloudPorts}
                    onChange={e => setCloudPorts(e.target.value)}
                    placeholder="80,443 or 1-1000"
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder-neutral-600 outline-none transition-all"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Profile</label>
                  <select
                    value={cloudProfile} onChange={e => setCloudProfile(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 rounded-lg px-4 py-2.5 text-sm text-white outline-none cursor-pointer"
                  >
                    <option value="fast">🚀 Fast  — Top 100 ports</option>
                    <option value="os">💻 OS &amp; Service Detection</option>
                    <option value="vuln">🛡️ Vulnerability Scan</option>
                    <option value="full">🔍 Full Scan — All 65k ports</option>
                  </select>
                </div>
                <div className="md:col-span-2 flex flex-col justify-end">
                  <button
                    type="submit" disabled={cloudScanning || !cloudTarget}
                    className={`h-[42px] w-full rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                      cloudScanning ? 'bg-indigo-900/40 text-indigo-400 cursor-wait'
                      : !cloudTarget ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                      : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-90 text-white shadow-lg shadow-indigo-500/30 cursor-pointer'
                    }`}
                  >
                    {cloudScanning
                      ? <><span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />Scanning</>
                      : <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Launch</>
                    }
                  </button>
                </div>
              </form>

              {/* status toast */}
              {cloudStatus === 'ok' && (
                <div className="relative z-10 mt-4 flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-lg w-fit">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  Scan queued! Results will appear in the table below.
                </div>
              )}
              {cloudStatus === 'error' && (
                <div className="relative z-10 mt-4 flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-4 py-2 rounded-lg w-fit">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  Failed to queue scan. Check MCP_URL on Railway.
                </div>
              )}
            </div>

            {/* Cloud Results Table */}
            <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
                <h2 className="font-bold text-white text-base flex items-center gap-2">
                  <span className="text-indigo-400">📋</span> Cloud Scan Results
                </h2>
                <span className="text-xs text-neutral-500 bg-neutral-800 px-2 py-1 rounded-full">{cloudScans.length} scans</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-950/50">
                    <tr className="text-xs text-neutral-500 uppercase tracking-wider">
                      <th className="px-6 py-3 text-left">Target</th>
                      <th className="px-6 py-3 text-left">Status</th>
                      <th className="px-6 py-3 text-left">Open Ports</th>
                      <th className="px-6 py-3 text-left">Time</th>
                      <th className="px-6 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={5} className="px-6 py-10 text-center text-neutral-600">Loading…</td></tr>
                    ) : cloudScans.length === 0 ? (
                      <tr><td colSpan={5} className="px-6 py-10 text-center text-neutral-600">No cloud scans yet. Launch one above.</td></tr>
                    ) : cloudScans.map(scan => {
                      const ports = parsePorts(scan.openPorts);
                      return (
                        <tr key={scan.id} className="border-t border-neutral-800/50 hover:bg-neutral-800/20 transition-colors">
                          <td className="px-6 py-3 font-mono text-indigo-400 font-medium">{scan.device?.ipAddress ?? '—'}</td>
                          <td className="px-6 py-3"><StatusBadge status={scan.status} /></td>
                          <td className="px-6 py-3 font-mono">
                            {scan.status === 'running' ? <span className="text-neutral-500 text-xs">Scanning via MCP…</span>
                            : ports.length > 0 ? <span className="text-red-400 font-bold">{ports.join(', ')}</span>
                            : <span className="text-neutral-600 text-xs">None found</span>}
                          </td>
                          <td className="px-6 py-3 text-neutral-500 text-xs">{new Date(scan.scannedAt).toLocaleString()}</td>
                          <td className="px-6 py-3 text-right">
                            <button onClick={() => setModalScan(scan)} className="text-xs px-3 py-1 rounded border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 transition-colors font-semibold">
                              View Report
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════
            DEVICE MONITOR TAB
            ════════════════════════════════════ */}
        {activeTab === 'device' && (
          <div className="space-y-6">

            {/* VPN Warning Banner */}
            <div className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl px-5 py-4">
              <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              <div>
                <p className="text-amber-400 font-semibold text-sm">VPN Required for Device Mode</p>
                <p className="text-amber-400/60 text-xs mt-0.5">The T-Embed device scans your local network. Connect a VPN or ensure the bridge is running to relay scan results back to the cloud backend.</p>
              </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Networks', value: networks.length, icon: '📡', color: 'emerald' },
                { label: 'Devices', value: devices.length, icon: '📱', color: 'teal' },
                { label: 'Scans Run', value: deviceScans.length, icon: '🔬', color: 'cyan' },
                { label: 'Open Ports Found', value: deviceScans.reduce((acc, s) => acc + parsePorts(s.openPorts).length, 0), icon: '🔓', color: 'red' },
              ].map(stat => (
                <div key={stat.label} className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-5">
                  <p className="text-2xl mb-1">{stat.icon}</p>
                  <p className="text-2xl font-black text-white">{stat.value}</p>
                  <p className="text-xs text-neutral-500 mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Networks + Devices side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Networks */}
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
                  <h2 className="font-bold text-white text-base flex items-center gap-2"><span className="text-emerald-400">📡</span> Discovered Networks</h2>
                  <span className="text-xs text-neutral-500 bg-neutral-800 px-2 py-1 rounded-full">{networks.length}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-950/50">
                      <tr className="text-xs text-neutral-500 uppercase tracking-wider">
                        <th className="px-5 py-3 text-left">SSID</th>
                        <th className="px-5 py-3 text-left">BSSID</th>
                        <th className="px-5 py-3 text-center">Devices</th>
                      </tr>
                    </thead>
                    <tbody>
                      {networks.length === 0 ? (
                        <tr><td colSpan={3} className="px-5 py-8 text-center text-neutral-600 text-xs">No networks logged yet.</td></tr>
                      ) : networks.map(net => (
                        <tr key={net.id} className="border-t border-neutral-800/50 hover:bg-neutral-800/20 transition-colors">
                          <td className="px-5 py-3 font-medium text-emerald-400">{net.ssid || 'Hidden'}</td>
                          <td className="px-5 py-3 font-mono text-neutral-400 text-xs">{net.bssid}</td>
                          <td className="px-5 py-3 text-center">
                            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-xs font-bold">{net._count?.devices ?? 0}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Devices */}
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
                  <h2 className="font-bold text-white text-base flex items-center gap-2"><span className="text-teal-400">📱</span> Local Devices</h2>
                  <span className="text-xs text-neutral-500 bg-neutral-800 px-2 py-1 rounded-full">{devices.length}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-950/50">
                      <tr className="text-xs text-neutral-500 uppercase tracking-wider">
                        <th className="px-5 py-3 text-left">IP</th>
                        <th className="px-5 py-3 text-left">MAC</th>
                        <th className="px-5 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devices.length === 0 ? (
                        <tr><td colSpan={3} className="px-5 py-8 text-center text-neutral-600 text-xs">No devices logged yet. Start the T-Embed bridge.</td></tr>
                      ) : devices.filter(d => !d.macAddress.startsWith('CUSTOM-')).map(dev => (
                        <tr key={dev.id} className="border-t border-neutral-800/50 hover:bg-neutral-800/20 transition-colors">
                          <td className="px-5 py-3 font-mono text-teal-400 font-medium">{dev.ipAddress ?? <span className="text-neutral-600">N/A</span>}</td>
                          <td className="px-5 py-3 font-mono text-neutral-400 text-xs">{dev.macAddress}</td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() => handleDeviceScan(dev.id, dev.ipAddress)}
                              disabled={!dev.ipAddress || scanningId === dev.id}
                              className={`text-xs px-3 py-1 rounded font-bold transition-colors ${
                                !dev.ipAddress ? 'text-neutral-600 cursor-not-allowed'
                                : scanningId === dev.id ? 'text-emerald-400 cursor-wait'
                                : 'border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
                              }`}
                            >
                              {scanningId === dev.id ? '…Scanning' : '▶ Scan IP'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Device Scan Results */}
            <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
                <h2 className="font-bold text-white text-base flex items-center gap-2"><span className="text-cyan-400">🔬</span> Device Scan Results</h2>
                <span className="text-xs text-neutral-500 bg-neutral-800 px-2 py-1 rounded-full">{deviceScans.length} scans</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-950/50">
                    <tr className="text-xs text-neutral-500 uppercase tracking-wider">
                      <th className="px-6 py-3 text-left">Target IP</th>
                      <th className="px-6 py-3 text-left">Status</th>
                      <th className="px-6 py-3 text-left">Open Ports</th>
                      <th className="px-6 py-3 text-left">Time</th>
                      <th className="px-6 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deviceScans.length === 0 ? (
                      <tr><td colSpan={5} className="px-6 py-10 text-center text-neutral-600 text-xs">No device scans yet.</td></tr>
                    ) : deviceScans.map(scan => {
                      const ports = parsePorts(scan.openPorts);
                      return (
                        <tr key={scan.id} className="border-t border-neutral-800/50 hover:bg-neutral-800/20 transition-colors">
                          <td className="px-6 py-3 font-mono text-teal-400 font-medium">{scan.device?.ipAddress ?? '—'}</td>
                          <td className="px-6 py-3"><StatusBadge status={scan.status} /></td>
                          <td className="px-6 py-3 font-mono">
                            {scan.status === 'running' ? <span className="text-neutral-500 text-xs">Scanning via MCP…</span>
                            : ports.length > 0 ? <span className="text-red-400 font-bold">{ports.join(', ')}</span>
                            : <span className="text-neutral-600 text-xs">None found</span>}
                          </td>
                          <td className="px-6 py-3 text-neutral-500 text-xs">{new Date(scan.scannedAt).toLocaleString()}</td>
                          <td className="px-6 py-3 text-right">
                            <button onClick={() => setModalScan(scan)} className="text-xs px-3 py-1 rounded border border-teal-500/30 text-teal-400 hover:bg-teal-500/10 transition-colors font-semibold">
                              View Report
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── MODAL ── */}
      {modalScan && <NmapModal scan={modalScan} onClose={() => setModalScan(null)} />}
    </div>
  );
}
